import assert from "node:assert/strict";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  guardOrganizationManagedLegacyAdminRequest,
  rewriteOrganizationManagedAccessResponse,
} from "../worker/organizationLegacyGuard.ts";

class Statement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private readonly organizationId: string | null) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return { organization_id: this.organizationId } as T;
  }
  async all<T>() {
    return { results: [] as T[] };
  }
}

class Db implements D1DatabaseLike {
  constructor(private readonly organizationId: string | null) {}
  prepare(_query: string) {
    return new Statement(this.organizationId);
  }
  async batch(_statements: D1PreparedStatement[]) {
    return [] as D1RunResult[];
  }
}

function post(path: string, body: unknown) {
  return new Request(`https://flyer.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://flyer.test" },
    body: JSON.stringify(body),
  });
}

test("new Campaign creation is central Organizer-only instead of legacy autocreate", async () => {
  const response = await guardOrganizationManagedLegacyAdminRequest(
    post("/api/campaigns", { snapshot: {} }),
    new Db(null),
  );
  assert.equal(response?.status, 409);
  assert.equal(
    (await response!.json() as { error: { code: string } }).error.code,
    "organization_campaign_create_required",
  );
});

test("Organization Campaign rejects local admin setup/reset/recovery endpoints", async () => {
  const db = new Db("org_a");
  for (const path of [
    "/api/admin/recover",
    "/api/admin/bootstrap",
    "/api/admin-accounts/setup",
    "/api/admin-accounts/password-reset",
  ]) {
    const response = await guardOrganizationManagedLegacyAdminRequest(
      post(path, { campaignId: "campaign_a", token: "x", secret: "x" }),
      db,
    );
    assert.equal(response?.status, 409);
    assert.equal((await response!.json() as { error: { code: string } }).error.code, "organization_identity_required");
  }
});

test("Organization Campaign rejects new admin access links but keeps field distribution links", async () => {
  const db = new Db("org_a");
  const admin = await guardOrganizationManagedLegacyAdminRequest(
    post("/api/campaigns/campaign_a/access", { role: "admin", teamId: null, label: "old admin" }),
    db,
  );
  assert.equal(admin?.status, 409);
  assert.equal((await admin!.json() as { error: { code: string } }).error.code, "organization_admin_invite_required");

  assert.equal(
    await guardOrganizationManagedLegacyAdminRequest(
      post("/api/campaigns/campaign_a/access", { role: "viewer", teamId: null, label: "reader" }),
      db,
    ),
    null,
  );
});

test("Legacy unowned Campaign keeps compatibility endpoints", async () => {
  const db = new Db(null);
  assert.equal(
    await guardOrganizationManagedLegacyAdminRequest(
      post("/api/admin-accounts/setup", { campaignId: "campaign_legacy", token: "x" }),
      db,
    ),
    null,
  );
});

test("access/current identifies Organization Campaigns and returns a central-login error when unauthorized", async () => {
  const db = new Db("org_a");
  const request = new Request("https://flyer.test/api/access/current?campaign=campaign_a");

  const unauthorized = await rewriteOrganizationManagedAccessResponse(
    request,
    db,
    Response.json({ error: { code: "access_required", message: "old" } }, { status: 401 }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(
    (await unauthorized.json() as { error: { code: string } }).error.code,
    "organization_access_required",
  );

  const authorized = await rewriteOrganizationManagedAccessResponse(
    request,
    db,
    Response.json({ access: { campaignId: "campaign_a", role: "admin", teamId: null, label: "Organizer" } }),
  );
  const payload = await authorized.json() as { access: { identityProvider?: string } };
  assert.equal(payload.access.identityProvider, "organization");
});