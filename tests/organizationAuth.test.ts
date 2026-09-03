import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  beginOrganizationPasswordLogin,
  bootstrapOrganization,
  completeOrganizationRecoveryLogin,
  completeOrganizationTotpLogin,
  disableOrganizationMembership,
  generateOrganizationTotpCode,
  organizationAccountSessionCookie,
  requireOrganizationCapability,
  resolveOrganizationAccountSession,
} from "../worker/organizationAuth.ts";

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
    for (const migration of ["0001_initial.sql", "0002_m4_access.sql", "0018_organization_admin_platform.sql"]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
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

function secretFromOtpUri(uri: string) {
  return new URL(uri).searchParams.get("secret") ?? "";
}

function requestWithSession(secret: string) {
  return new Request("https://flyer.test/api/organization/me", {
    headers: { cookie: organizationAccountSessionCookie(secret).split(";")[0] },
  });
}

async function createBootstrappedOrganization(db: OrganizationDb) {
  const result = await bootstrapOrganization(db, {
    organizationName: "Test Organization",
    username: "Master.Admin",
    password,
    totpKey,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

test("organization bootstrap stores verifier, encrypted TOTP and hashed recovery codes only", async () => {
  const db = new OrganizationDb();
  const created = await createBootstrappedOrganization(db);
  const passwordRow = db.sqlite.prepare(
    "SELECT algorithm, iterations, salt, verifier FROM organization_password_credentials",
  ).get() as Record<string, unknown>;
  assert.equal(passwordRow.algorithm, "pbkdf2-sha256-v1");
  assert.equal(passwordRow.iterations, 600_000);
  assert.notEqual(passwordRow.verifier, password);

  const totpSecret = secretFromOtpUri(created.otpauthUri);
  const totpRow = db.sqlite.prepare(
    "SELECT secret_ciphertext, secret_nonce FROM organization_totp_credentials",
  ).get() as Record<string, unknown>;
  assert.equal(JSON.stringify(totpRow).includes(totpSecret), false);

  const recoveryRows = db.sqlite.prepare(
    "SELECT code_hash FROM organization_recovery_codes",
  ).all() as Array<{ code_hash: string }>;
  assert.equal(recoveryRows.length, 10);
  for (const code of created.recoveryCodes) {
    assert.equal(recoveryRows.some((row) => row.code_hash.includes(code)), false);
  }

  const second = await bootstrapOrganization(db, {
    organizationName: "Race Winner",
    username: "second.admin",
    password,
    totpKey,
  });
  assert.deepEqual(second, { ok: false, code: "bootstrap_unavailable" });
});

test("password plus TOTP is required and an accepted TOTP counter cannot be replayed", async () => {
  const db = new OrganizationDb();
  const created = await createBootstrappedOrganization(db);
  const secret = secretFromOtpUri(created.otpauthUri);
  const nowMs = Date.now();
  const initialCode = await generateOrganizationTotpCode(secret, nowMs);
  const completed = await completeOrganizationTotpLogin(db, {
    challengeSecret: created.challengeSecret,
    code: initialCode,
    totpKey,
    nowMs,
  });
  assert.equal(completed.ok, true);
  if (!completed.ok) return;
  assert.equal(completed.session.assurance, "mfa");

  const resolved = await resolveOrganizationAccountSession(db, requestWithSession(completed.session.secret));
  assert.equal(resolved?.username, "Master.Admin");
  assert.equal(resolved?.assurance, "mfa");

  const login = await beginOrganizationPasswordLogin(db, {
    username: "MASTER.ADMIN",
    password,
  });
  assert.equal(login.ok, true);
  if (!login.ok) return;
  const replay = await completeOrganizationTotpLogin(db, {
    challengeSecret: login.challengeSecret,
    code: initialCode,
    totpKey,
    nowMs,
  });
  assert.equal(replay.ok, false);

  const nextLogin = await beginOrganizationPasswordLogin(db, {
    username: "master.admin",
    password,
  });
  assert.equal(nextLogin.ok, true);
  if (!nextLogin.ok) return;
  const nextCode = await generateOrganizationTotpCode(secret, nowMs + 30_000);
  const next = await completeOrganizationTotpLogin(db, {
    challengeSecret: nextLogin.challengeSecret,
    code: nextCode,
    totpKey,
    nowMs: nowMs + 30_000,
  });
  assert.equal(next.ok, true);
});

test("recovery code is single-use and creates a restricted recovery session", async () => {
  const db = new OrganizationDb();
  const created = await createBootstrappedOrganization(db);
  const secret = secretFromOtpUri(created.otpauthUri);
  const nowMs = Date.now();
  const initial = await completeOrganizationTotpLogin(db, {
    challengeSecret: created.challengeSecret,
    code: await generateOrganizationTotpCode(secret, nowMs),
    totpKey,
    nowMs,
  });
  assert.equal(initial.ok, true);

  const login = await beginOrganizationPasswordLogin(db, { username: "master.admin", password });
  assert.equal(login.ok, true);
  if (!login.ok) return;
  const recovered = await completeOrganizationRecoveryLogin(db, {
    challengeSecret: login.challengeSecret,
    recoveryCode: created.recoveryCodes[0],
  });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.session.assurance, "recovery");

  const restrictedRequest = requestWithSession(recovered.session.secret);
  const denied = await requireOrganizationCapability(
    db,
    restrictedRequest,
    created.organization.id,
    "campaign.create",
  );
  assert.deepEqual(denied, { ok: false, code: "mfa_required" });

  const secondLogin = await beginOrganizationPasswordLogin(db, { username: "master.admin", password });
  assert.equal(secondLogin.ok, true);
  if (!secondLogin.ok) return;
  const reused = await completeOrganizationRecoveryLogin(db, {
    challengeSecret: secondLogin.challengeSecret,
    recoveryCode: created.recoveryCodes[0],
  });
  assert.equal(reused.ok, false);
});

test("organization capability resolution is tenant-scoped", async () => {
  const db = new OrganizationDb();
  const created = await createBootstrappedOrganization(db);
  const nowMs = Date.now();
  const login = await completeOrganizationTotpLogin(db, {
    challengeSecret: created.challengeSecret,
    code: await generateOrganizationTotpCode(secretFromOtpUri(created.otpauthUri), nowMs),
    totpKey,
    nowMs,
  });
  assert.equal(login.ok, true);
  if (!login.ok) return;
  const request = requestWithSession(login.session.secret);
  assert.equal(
    (await requireOrganizationCapability(db, request, created.organization.id, "campaign.create")).ok,
    true,
  );

  const otherOrgId = "org_foreign";
  const timestamp = new Date().toISOString();
  db.sqlite.prepare("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(otherOrgId, "Foreign Org", timestamp, timestamp);
  assert.deepEqual(
    await requireOrganizationCapability(db, request, otherOrgId, "campaign.create"),
    { ok: false, code: "forbidden" },
  );
});

test("concurrent organizer disable attempts cannot remove the final active organizer", async () => {
  const db = new OrganizationDb();
  const created = await createBootstrappedOrganization(db);
  const first = db.sqlite.prepare(
    "SELECT id, account_id FROM organization_memberships WHERE organization_id = ?",
  ).get(created.organization.id) as { id: string; account_id: string };
  const now = new Date().toISOString();
  const secondAccountId = "org_account_second";
  const secondMembershipId = "org_membership_second";
  db.sqlite.prepare(
    "INSERT INTO organization_accounts (id, username, username_normalized, disabled_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
  ).run(secondAccountId, "second.organizer", "second.organizer", now, now);
  db.sqlite.prepare(
    "INSERT INTO organization_memberships (id, organization_id, account_id, role_kind, role_template_id, capabilities_json, disabled_at, created_at, updated_at) VALUES (?, ?, ?, 'organizer', NULL, '[]', NULL, ?, ?)",
  ).run(secondMembershipId, created.organization.id, secondAccountId, now, now);

  const results = await Promise.all([
    disableOrganizationMembership(db, created.organization.id, first.id),
    disableOrganizationMembership(db, created.organization.id, secondMembershipId),
  ]);
  assert.equal(results.filter((value) => value === "disabled").length, 1);
  assert.equal(results.filter((value) => value === "last_organizer").length, 1);
  const active = db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND role_kind = 'organizer' AND disabled_at IS NULL",
  ).get(created.organization.id) as { count: number };
  assert.equal(active.count, 1);
});
