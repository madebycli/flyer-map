import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import {
  beginOrganizationPasswordLogin,
  bootstrapOrganization,
  completeOrganizationRecoveryLogin,
  completeOrganizationTotpLogin,
  generateOrganizationTotpCode,
  organizationAccountSessionCookie,
  resolveOrganizationAccountSession,
} from "../worker/organizationAuth.ts";
import {
  createOrganizationInvite,
  createOrganizationPasswordReset,
  parseOrganizationCapabilities,
  redeemOrganizationInvite,
  redeemOrganizationPasswordReset,
  restartOrganizationTotpEnrollment,
} from "../worker/organizationSecurity.ts";

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(readonly query: string, private readonly sqlite: DatabaseSync) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.sqlite.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    return this.sqlite.prepare(this.query).run(...this.values);
  }
}

class OrganizationDb implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrationsUrl = new URL("../migrations/", import.meta.url);
    const migrations = readdirSync(migrationsUrl)
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    for (const migration of migrations) {
      this.sqlite.exec(readFileSync(new URL(migration, migrationsUrl), "utf8"));
    }
  }

  prepare(query: string) {
    return new Statement(query, this.sqlite);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as Statement[]).map<D1RunResult>((statement) => {
        const result = statement.run();
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const totpKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const password = "eine-sehr-sichere-passphrase";
const nextPassword = "noch-eine-sehr-sichere-passphrase";

function secretFromOtpUri(uri: string) {
  return new URL(uri).searchParams.get("secret") ?? "";
}

function requestWithSession(secret: string) {
  return new Request("https://flyer.test/api/organization/me", {
    headers: { cookie: organizationAccountSessionCookie(secret).split(";")[0] },
  });
}

async function bootstrap(db: OrganizationDb) {
  const created = await bootstrapOrganization(db, {
    organizationName: "Security Test Organization",
    username: "security.master",
    password,
    totpKey,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.code);
  const nowMs = Date.now();
  const completed = await completeOrganizationTotpLogin(db, {
    challengeSecret: created.challengeSecret,
    code: await generateOrganizationTotpCode(secretFromOtpUri(created.otpauthUri), nowMs),
    totpKey,
    nowMs,
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) throw new Error(completed.code);
  return { created, completed };
}

test("organization capability parser rejects unknown capabilities instead of silently widening roles", () => {
  assert.deepEqual(parseOrganizationCapabilities(["campaign.manage", "audit.read"]), ["campaign.manage", "audit.read"]);
  assert.equal(parseOrganizationCapabilities(["campaign.manage", "superuser.everything"]), null);
  assert.equal(parseOrganizationCapabilities("campaign.manage"), null);
});

test("organization invite secret is hashed, can be claimed only once, and enrolls MFA", async () => {
  const db = new OrganizationDb();
  const { created } = await bootstrap(db);
  const invite = await createOrganizationInvite(db, {
    organizationId: created.organization.id,
    actorAccountId: created.account.id,
    role: "admin",
    capabilities: ["campaign.manage", "audit.read"],
  });
  const stored = db.sqlite.prepare("SELECT token_hash FROM organization_invites WHERE id = ?").get(invite.id) as { token_hash: string };
  assert.notEqual(stored.token_hash, invite.secret);
  assert.equal(stored.token_hash.includes(invite.secret), false);

  const redeemed = await redeemOrganizationInvite(db, {
    inviteSecret: invite.secret,
    username: "invited.admin",
    password,
    totpKey,
  });
  assert.equal(redeemed.ok, true);
  if (!redeemed.ok) return;
  assert.equal(redeemed.membership.role, "admin");
  const membership = db.sqlite.prepare(
    "SELECT capabilities_json FROM organization_memberships WHERE account_id = ? AND organization_id = ?",
  ).get(redeemed.account.id, created.organization.id) as { capabilities_json: string };
  assert.deepEqual(JSON.parse(membership.capabilities_json), ["campaign.manage", "audit.read"]);

  const second = await redeemOrganizationInvite(db, {
    inviteSecret: invite.secret,
    username: "second.invited",
    password,
    totpKey,
  });
  assert.deepEqual(second, { ok: false, code: "invite_unavailable" });

  const nowMs = Date.now();
  const mfa = await completeOrganizationTotpLogin(db, {
    challengeSecret: redeemed.challengeSecret,
    code: await generateOrganizationTotpCode(secretFromOtpUri(redeemed.otpauthUri), nowMs),
    totpKey,
    nowMs,
  });
  assert.equal(mfa.ok, true);
});

test("organization password reset is one-time and revokes existing sessions", async () => {
  const db = new OrganizationDb();
  const { created, completed } = await bootstrap(db);
  const oldSessionRequest = requestWithSession(completed.session.secret);
  assert.equal((await resolveOrganizationAccountSession(db, oldSessionRequest))?.accountId, created.account.id);

  const reset = await createOrganizationPasswordReset(db, {
    organizationId: created.organization.id,
    targetAccountId: created.account.id,
    actorAccountId: created.account.id,
  });
  assert.equal(reset.ok, true);
  if (!reset.ok) return;
  const stored = db.sqlite.prepare("SELECT token_hash FROM organization_password_resets WHERE id = ?").get(reset.id) as { token_hash: string };
  assert.notEqual(stored.token_hash, reset.secret);

  const redeemed = await redeemOrganizationPasswordReset(db, {
    resetSecret: reset.secret,
    password: nextPassword,
  });
  assert.deepEqual(redeemed, { ok: true });
  assert.equal(await resolveOrganizationAccountSession(db, oldSessionRequest), null);
  assert.equal((await beginOrganizationPasswordLogin(db, { username: created.account.username, password })).ok, false);
  assert.equal((await beginOrganizationPasswordLogin(db, { username: created.account.username, password: nextPassword })).ok, true);
  assert.deepEqual(
    await redeemOrganizationPasswordReset(db, { resetSecret: reset.secret, password }),
    { ok: false, code: "reset_unavailable" },
  );
});

test("TOTP restart rotates recovery codes, revokes old sessions, and requires fresh enrollment", async () => {
  const db = new OrganizationDb();
  const { created, completed } = await bootstrap(db);
  const passwordLogin = await beginOrganizationPasswordLogin(db, {
    username: created.account.username,
    password,
  });
  assert.equal(passwordLogin.ok, true);
  if (!passwordLogin.ok) return;
  const recovery = await completeOrganizationRecoveryLogin(db, {
    challengeSecret: passwordLogin.challengeSecret,
    recoveryCode: created.recoveryCodes[0],
  });
  assert.equal(recovery.ok, true);
  if (!recovery.ok) return;

  const restarted = await restartOrganizationTotpEnrollment(db, {
    organizationId: created.organization.id,
    accountId: created.account.id,
    username: created.account.username,
    currentPassword: password,
    totpKey,
  });
  assert.equal(restarted.ok, true);
  if (!restarted.ok) return;
  assert.equal(restarted.recoveryCodes.length, 10);
  assert.equal(restarted.recoveryCodes.includes(created.recoveryCodes[0]), false);
  assert.equal(await resolveOrganizationAccountSession(db, requestWithSession(completed.session.secret)), null);
  assert.equal(await resolveOrganizationAccountSession(db, requestWithSession(recovery.session.secret)), null);

  const nowMs = Date.now();
  const completedAgain = await completeOrganizationTotpLogin(db, {
    challengeSecret: restarted.challengeSecret,
    code: await generateOrganizationTotpCode(secretFromOtpUri(restarted.otpauthUri), nowMs),
    totpKey,
    nowMs,
  });
  assert.equal(completedAgain.ok, true);
});
