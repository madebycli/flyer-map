import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignIdFromOrganizationPath,
  isOrganizationAdminPath,
  safeOrganizationNext,
} from "../src/organization/organizationRoutes.ts";

test("organization admin routes do not capture the field-map root", () => {
  assert.equal(isOrganizationAdminPath("/"), false);
  assert.equal(isOrganizationAdminPath("/start"), true);
  assert.equal(isOrganizationAdminPath("/login"), true);
  assert.equal(isOrganizationAdminPath("/new"), true);
  assert.equal(isOrganizationAdminPath("/admin"), true);
  assert.equal(isOrganizationAdminPath("/admin/campaign/campaign_123"), true);
  assert.equal(isOrganizationAdminPath("/api/organization/me"), false);
});

test("organization login next target is restricted to internal admin routes", () => {
  assert.equal(safeOrganizationNext("/admin"), "/admin");
  assert.equal(safeOrganizationNext("/new?organization=org_123"), "/new?organization=org_123");
  assert.equal(safeOrganizationNext("/admin/campaign/campaign_123#security"), "/admin/campaign/campaign_123#security");
  assert.equal(safeOrganizationNext("https://evil.example/admin"), "/admin");
  assert.equal(safeOrganizationNext("//evil.example/admin"), "/admin");
  assert.equal(safeOrganizationNext("/not-an-admin-route"), "/admin");
});

test("campaign admin path parser rejects malformed selectors", () => {
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/campaign_123"), "campaign_123");
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/a%2Fb"), null);
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/"), null);
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/x/extra"), null);
});
