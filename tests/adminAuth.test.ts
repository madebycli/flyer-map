import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  adminAccountSessionCookie,
  completeCampaignAdminPasswordReset,
  completeCampaignAdminSetup,
  createCampaignAdminPasswordResetInvite,
  createCampaignAdminSetupInvite,
  disableCampaignAdminAccount,
  loginCampaignAdminAccount,
  renameCampaignAdminAccount,
} from "../worker/adminAuth.ts";
import { resolveAccess } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

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

class AdminAuthDb implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0015_mission_campaign_admin_accounts.sql",
      "0016_mission_campaign_admin_password_resets.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
    const now = "2026-09-01T12:00:00.000Z";
    this.sqlite.prepare(
      "INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, ?, 'active', 0, 'seed', ?, ?)",
    ).run("campaign_admin-auth", "Admin Auth", now, now);
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

const campaignId = "campaign_admin-auth";

function requestWithAdminCookie(secret: string) {
  return new Request("https://flyer.test/api/access/current?campaign=" + campaignId, {
    headers: { cookie: adminAccountSessionCookie(secret).split(";")[0] },
  });
}

test("one-time Campaign Admin setup stores only a PBKDF2 verifier and issues a revocable session", async () => {
  const db = new AdminAuthDb();
  const invite = await createCampaignAdminSetupInvite(db, campaignId);
  const created = await completeCampaignAdminSetup(db, {
    campaignId,
    token: invite.token,
    username: "Mission.Admin",
    password: "ein-sicheres-passwort",
  });

  assert.equal(created.ok, true);
  if (!created.ok) return;
  const row = db.sqlite.prepare(
    "SELECT username, username_normalized, password_algorithm, password_iterations, password_salt, password_hash FROM campaign_admin_accounts",
  ).get() as Record<string, unknown>;
  assert.deepEqual(
    { username: row.username, username_normalized: row.username_normalized, password_algorithm: row.password_algorithm, password_iterations: row.password_iterations },
    { username: "Mission.Admin", username_normalized: "mission.admin", password_algorithm: "pbkdf2-sha256-v1", password_iterations: 600_000 },
  );
  assert.notEqual(row.password_hash, "ein-sicheres-passwort");
  assert.equal(JSON.stringify(row).includes(invite.token), false);
  assert.equal(
    (await resolveAccess(db, requestWithAdminCookie(created.session.sessionSecret), campaignId))?.role,
    "admin",
  );
  assert.equal((await completeCampaignAdminSetup(db, {
    campaignId,
    token: invite.token,
    username: "second.admin",
    password: "ein-weiteres-sicheres-passwort",
  })).ok, false);
});

test("Campaign Admin login uses the stored verifier and rejects incorrect credentials", async () => {
  const db = new AdminAuthDb();
  const invite = await createCampaignAdminSetupInvite(db, campaignId);
  await completeCampaignAdminSetup(db, {
    campaignId,
    token: invite.token,
    username: "admin.one",
    password: "ein-sicheres-passwort",
  });
  assert.equal((await loginCampaignAdminAccount(db, {
    campaignId,
    username: "ADMIN.ONE",
    password: "falsches-passwort",
  })).ok, false);
  const loggedIn = await loginCampaignAdminAccount(db, {
    campaignId,
    username: "ADMIN.ONE",
    password: "ein-sicheres-passwort",
  });
  assert.equal(loggedIn.ok, true);
  if (!loggedIn.ok) return;
  assert.equal(
    (await resolveAccess(db, requestWithAdminCookie(loggedIn.session.sessionSecret), campaignId))?.label,
    "admin.one",
  );
});

test("organizer can rename an Admin and issue a one-time password reset that revokes old sessions", async () => {
  const db = new AdminAuthDb();
  const setup = await createCampaignAdminSetupInvite(db, campaignId);
  const created = await completeCampaignAdminSetup(db, {
    campaignId,
    token: setup.token,
    username: "admin.one",
    password: "ein-sicheres-passwort",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const account = db.sqlite.prepare("SELECT id FROM campaign_admin_accounts").get() as { id: string };
  assert.deepEqual(
    await renameCampaignAdminAccount(db, campaignId, account.id, "Organisator.1"),
    { ok: true, username: "Organisator.1" },
  );
  assert.equal(
    (await resolveAccess(db, requestWithAdminCookie(created.session.sessionSecret), campaignId))?.label,
    "Organisator.1",
  );

  const firstReset = await createCampaignAdminPasswordResetInvite(db, campaignId, account.id);
  const reset = await createCampaignAdminPasswordResetInvite(db, campaignId, account.id);
  assert.ok(firstReset);
  assert.ok(reset);
  if (!firstReset || !reset) return;
  assert.equal((await completeCampaignAdminPasswordReset(db, {
    campaignId,
    token: firstReset.token,
    password: "noch-ein-sicheres-passwort",
  })).ok, false);

  const competingResets = await Promise.all([
    completeCampaignAdminPasswordReset(db, {
      campaignId,
      token: reset.token,
      password: "noch-ein-sicheres-passwort",
    }),
    completeCampaignAdminPasswordReset(db, {
      campaignId,
      token: reset.token,
      password: "ein-anderes-sicheres-passwort",
    }),
  ]);
  assert.equal(competingResets.filter((result) => result.ok).length, 1);
  const completed = competingResets.find((result) => result.ok);
  assert.ok(completed);
  if (!completed?.ok) return;
  const replacementPassword = competingResets[0].ok
    ? "noch-ein-sicheres-passwort"
    : "ein-anderes-sicheres-passwort";
  assert.equal(
    await resolveAccess(db, requestWithAdminCookie(created.session.sessionSecret), campaignId),
    null,
  );
  assert.equal((await loginCampaignAdminAccount(db, {
    campaignId,
    username: "organisator.1",
    password: "ein-sicheres-passwort",
  })).ok, false);
  assert.equal((await loginCampaignAdminAccount(db, {
    campaignId,
    username: "organisator.1",
    password: replacementPassword,
  })).ok, true);
  assert.equal((await completeCampaignAdminPasswordReset(db, {
    campaignId,
    token: reset.token,
    password: "darf-nicht-gesetzt-werden",
  })).ok, false);
});

test("the last active Campaign Admin account cannot be disabled", async () => {
  const db = new AdminAuthDb();
  const setup = await createCampaignAdminSetupInvite(db, campaignId);
  const created = await completeCampaignAdminSetup(db, {
    campaignId,
    token: setup.token,
    username: "last.admin",
    password: "ein-sicheres-passwort",
  });
  assert.equal(created.ok, true);
  const account = db.sqlite.prepare("SELECT id FROM campaign_admin_accounts").get() as { id: string };
  assert.equal(await disableCampaignAdminAccount(db, campaignId, account.id), "last_account");
  assert.equal(
    db.sqlite.prepare("SELECT disabled_at FROM campaign_admin_accounts WHERE id = ?").get(account.id)?.disabled_at,
    null,
  );
});
