import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, seedNetwork } from "./helpers/networkD1.ts";
import {
  augmentCampaignAdminRememberResponse,
  handleCampaignAdminRememberRoute,
} from "../worker/campaignAdminRememberBridge.ts";
import {
  augmentOrganizationRememberResponse,
  handleOrganizationRememberRoute,
} from "../worker/organizationRememberBridge.ts";

function cookieValue(setCookie: string, name: string) {
  for (const part of setCookie.split(/,(?=\s*__Host-|\s*vf_)/u)) {
    const match = part.trim().match(new RegExp(`^${name}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function cookieHeader(response: Response, name: string) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  for (const value of values) {
    const found = cookieValue(value, name);
    if (found) return found;
  }
  return null;
}

function request(path: string, body: unknown, cookie?: string) {
  return new Request(`https://flyer.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://flyer.test",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("organization remembered device is issued after MFA login, rotates on refresh and tolerates immediate cross-tab overlap", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  const now = "2026-09-14T18:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO organization_accounts
      (id, username, username_normalized, disabled_at, created_at, updated_at, mfa_required)
     VALUES ('org_account_a', 'Alice', 'alice', NULL, ?, ?, 1)`,
  ).run(now, now);

  const loginRequest = request("/api/organization/login/totp", { code: "123456", rememberDevice: true });
  const loginResponse = await augmentOrganizationRememberResponse(
    loginRequest,
    db,
    Response.json({ account: { id: "org_account_a", username: "Alice" }, assurance: "mfa" }),
  );
  const firstSecret = cookieHeader(loginResponse, "__Host-vf_organization_remember");
  assert.ok(firstSecret, "successful MFA login must issue a remember cookie when explicitly requested");

  const refreshRequest = request(
    "/api/organization/session/refresh",
    {},
    `__Host-vf_organization_remember=${encodeURIComponent(firstSecret!)}`,
  );
  const refreshed = await handleOrganizationRememberRoute(refreshRequest, db);
  assert.ok(refreshed);
  assert.equal(refreshed.status, 200);
  const rotatedSecret = cookieHeader(refreshed, "__Host-vf_organization_remember");
  assert.ok(rotatedSecret);
  assert.notEqual(rotatedSecret, firstSecret);
  assert.ok(cookieHeader(refreshed, "__Host-vf_organization_session"));
  assert.equal(
    (db.sqlite.prepare("SELECT COUNT(*) AS count FROM organization_account_sessions WHERE account_id='org_account_a'").get() as { count: number }).count,
    1,
  );

  const concurrentOldCookie = await handleOrganizationRememberRoute(
    request(
      "/api/organization/session/refresh",
      {},
      `__Host-vf_organization_remember=${encodeURIComponent(firstSecret!)}`,
    ),
    db,
  );
  assert.ok(concurrentOldCookie);
  assert.equal(concurrentOldCookie.status, 409);
  assert.equal(cookieHeader(concurrentOldCookie, "__Host-vf_organization_remember"), null, "benign overlap must not clear the replacement cookie");

  const replacementStillValid = await handleOrganizationRememberRoute(
    request(
      "/api/organization/session/refresh",
      {},
      `__Host-vf_organization_remember=${encodeURIComponent(rotatedSecret!)}`,
    ),
    db,
  );
  assert.ok(replacementStillValid);
  assert.equal(replacementStillValid.status, 200);
});

test("organization optional-MFA password login can remember and later renew the short session", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  const now = "2026-09-14T18:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO organization_accounts
      (id, username, username_normalized, disabled_at, created_at, updated_at, mfa_required)
     VALUES ('org_account_optional', 'Optional', 'optional', NULL, ?, ?, 0)`,
  ).run(now, now);

  const loginResponse = await augmentOrganizationRememberResponse(
    request("/api/organization/login/password", { username: "Optional", password: "secret", rememberDevice: true }),
    db,
    Response.json({ account: { id: "org_account_optional", username: "Optional" }, assurance: "mfa", requiresFactor: false }),
  );
  const rememberSecret = cookieHeader(loginResponse, "__Host-vf_organization_remember");
  assert.ok(rememberSecret);
  const stored = db.sqlite.prepare(
    "SELECT assurance FROM auth_trusted_devices WHERE subject_kind='organization_account' AND subject_id='org_account_optional' AND revoked_at IS NULL",
  ).get() as { assurance: string };
  assert.equal(stored.assurance, "password");

  const refreshed = await handleOrganizationRememberRoute(
    request(
      "/api/organization/session/refresh",
      {},
      `__Host-vf_organization_remember=${encodeURIComponent(rememberSecret!)}`,
    ),
    db,
  );
  assert.ok(refreshed);
  assert.equal(refreshed.status, 200, "optional-MFA Unstable accounts must be able to renew a remembered short session");
  assert.ok(cookieHeader(refreshed, "__Host-vf_organization_session"));
});

test("campaign admin remembered device rotates into a new short admin session and is campaign scoped", async (t) => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  t.after(() => db.sqlite.close());
  const now = "2026-09-14T18:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO campaign_access_grants
      (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_admin_a', 'campaign_n', 'admin', NULL, 'grant_hash_a', 'Admin', ?, NULL)`,
  ).run(now);
  db.sqlite.prepare(
    `INSERT INTO campaign_admin_accounts
      (id, campaign_id, grant_id, username, username_normalized,
       password_algorithm, password_iterations, password_salt, password_hash, created_at, disabled_at)
     VALUES ('admin_account_a', 'campaign_n', 'grant_admin_a', 'AdminA', 'admina',
       'pbkdf2-sha256-v1', 600000, 'salt', 'hash', ?, NULL)`,
  ).run(now);

  const loginRequest = request(
    "/api/campaigns/campaign_n/admin-accounts/login",
    { username: "AdminA", password: "irrelevant-after-success", rememberDevice: true },
  );
  const loginResponse = await augmentCampaignAdminRememberResponse(
    loginRequest,
    db,
    Response.json({ access: { campaignId: "campaign_n", role: "admin", teamId: null, label: "AdminA" } }),
  );
  const firstSecret = cookieHeader(loginResponse, "__Host-vf_campaign_admin_remember");
  assert.ok(firstSecret);

  const refreshed = await handleCampaignAdminRememberRoute(
    request(
      "/api/campaigns/campaign_n/admin-accounts/session/refresh",
      {},
      `__Host-vf_campaign_admin_remember=${encodeURIComponent(firstSecret!)}`,
    ),
    db,
  );
  assert.ok(refreshed);
  assert.equal(refreshed.status, 200);
  assert.ok(cookieHeader(refreshed, "vf_admin_account_session"));
  const rotatedSecret = cookieHeader(refreshed, "__Host-vf_campaign_admin_remember");
  assert.ok(rotatedSecret);
  assert.notEqual(rotatedSecret, firstSecret);

  const wrongCampaign = await handleCampaignAdminRememberRoute(
    request(
      "/api/campaigns/campaign_other/admin-accounts/session/refresh",
      {},
      `__Host-vf_campaign_admin_remember=${encodeURIComponent(rotatedSecret!)}`,
    ),
    db,
  );
  assert.ok(wrongCampaign);
  assert.equal(wrongCampaign.status, 401, "a remembered campaign admin token must not cross campaign scope");
});
