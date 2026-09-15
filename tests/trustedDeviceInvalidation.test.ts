import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, seedNetwork } from "./helpers/networkD1.ts";
import {
  captureTrustedDeviceInvalidations,
  applyTrustedDeviceInvalidations,
} from "../worker/trustedDeviceInvalidation.ts";
import {
  createTrustedDevice,
  consumeTrustedDevice,
} from "../worker/trustedDevice.ts";

const now = "2026-09-14T18:00:00.000Z";

function deleteRequest(path: string) {
  return new Request(`https://flyer.test${path}`, {
    method: "DELETE",
    headers: { origin: "https://flyer.test" },
  });
}

test("successful organization membership removal revokes remembered devices for that account", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  db.sqlite.prepare("INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_a','Org A',?,?)").run(now, now);
  db.sqlite.prepare("INSERT INTO organization_accounts(id,username,username_normalized,disabled_at,created_at,updated_at,mfa_required) VALUES('org_account_a','Alice','alice',NULL,?,?,1)").run(now, now);
  db.sqlite.prepare("INSERT INTO organization_memberships(id,organization_id,account_id,role_kind,role_template_id,capabilities_json,disabled_at,created_at,updated_at) VALUES('membership_a','org_a','org_account_a','admin',NULL,'[]',NULL,?,?)").run(now, now);
  const token = await createTrustedDevice(db, { subjectKind: "organization_account", subjectId: "org_account_a", assurance: "mfa" });
  assert.ok(token);

  const request = deleteRequest("/api/organizations/org_a/members/membership_a");
  const subjects = await captureTrustedDeviceInvalidations(request, db);
  assert.deepEqual(subjects, [{ kind: "organization_account", id: "org_account_a" }]);
  await applyTrustedDeviceInvalidations(db, subjects, Response.json({ ok: true }));

  const consumed = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: token.secret,
    validateSubject: async () => true,
  });
  assert.deepEqual(consumed, { ok: false, code: "invalid" });
});

test("successful campaign admin disable revokes remembered devices for that account", async (t) => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  t.after(() => db.sqlite.close());
  db.sqlite.prepare("INSERT INTO campaign_access_grants(id,campaign_id,role,team_id,token_hash,label,created_at,revoked_at) VALUES('grant_admin','campaign_n','admin',NULL,'grant_hash','Admin',?,NULL)").run(now);
  db.sqlite.prepare("INSERT INTO campaign_admin_accounts(id,campaign_id,grant_id,username,username_normalized,password_algorithm,password_iterations,password_salt,password_hash,created_at,disabled_at) VALUES('admin_account_a','campaign_n','grant_admin','AdminA','admina','pbkdf2-sha256-v1',600000,'salt','hash',?,NULL)").run(now);
  const token = await createTrustedDevice(db, { subjectKind: "campaign_admin", subjectId: "admin_account_a", assurance: "password" });
  assert.ok(token);

  const request = deleteRequest("/api/campaigns/campaign_n/admin-accounts/admin_account_a");
  const subjects = await captureTrustedDeviceInvalidations(request, db);
  assert.deepEqual(subjects, [{ kind: "campaign_admin", id: "admin_account_a" }]);
  await applyTrustedDeviceInvalidations(db, subjects, Response.json({ ok: true }));

  const consumed = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: token.secret,
    validateSubject: async () => true,
  });
  assert.deepEqual(consumed, { ok: false, code: "invalid" });
});

test("failed credential change does not revoke trusted devices", async (t) => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  t.after(() => db.sqlite.close());
  db.sqlite.prepare("INSERT INTO campaign_access_grants(id,campaign_id,role,team_id,token_hash,label,created_at,revoked_at) VALUES('grant_admin_b','campaign_n','admin',NULL,'grant_hash_b','Admin',?,NULL)").run(now);
  db.sqlite.prepare("INSERT INTO campaign_admin_accounts(id,campaign_id,grant_id,username,username_normalized,password_algorithm,password_iterations,password_salt,password_hash,created_at,disabled_at) VALUES('admin_account_b','campaign_n','grant_admin_b','AdminB','adminb','pbkdf2-sha256-v1',600000,'salt','hash',?,NULL)").run(now);
  const token = await createTrustedDevice(db, { subjectKind: "campaign_admin", subjectId: "admin_account_b", assurance: "password" });
  assert.ok(token);

  const request = new Request("https://flyer.test/api/campaigns/campaign_n/admin-accounts/admin_account_b", {
    method: "PATCH",
    headers: { origin: "https://flyer.test", "content-type": "application/json" },
    body: JSON.stringify({ username: "bad" }),
  });
  const subjects = await captureTrustedDeviceInvalidations(request, db);
  await applyTrustedDeviceInvalidations(db, subjects, Response.json({ error: { code: "invalid" } }, { status: 400 }));

  const consumed = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: token.secret,
    validateSubject: async () => true,
  });
  assert.equal(consumed.ok, true, "a rejected credential mutation must not log the device out");
});
