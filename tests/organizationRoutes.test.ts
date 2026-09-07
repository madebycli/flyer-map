import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignIdFromOrganizationPath,
  isOrganizationAdminPath,
  safeOrganizationNext,
} from "../src/organization/organizationRoutes.ts";

test("organizer routes are isolated from field root", () => {
  assert.equal(isOrganizationAdminPath("/start"), true);
  assert.equal(isOrganizationAdminPath("/login"), true);
  assert.equal(isOrganizationAdminPath("/join"), true);
  assert.equal(isOrganizationAdminPath("/reset"), true);
  assert.equal(isOrganizationAdminPath("/new"), true);
  assert.equal(isOrganizationAdminPath("/admin"), true);
  assert.equal(isOrganizationAdminPath("/admin/security"), true);
  assert.equal(isOrganizationAdminPath("/admin/campaign/campaign_123"), true);
  assert.equal(isOrganizationAdminPath("/"), false);
  assert.equal(isOrganizationAdminPath("/workbench"), false);
});

test("safe organizer next accepts only authenticated internal admin routes", () => {
  assert.equal(safeOrganizationNext("/admin/campaign/campaign_123?tab=settings"), "/admin/campaign/campaign_123?tab=settings");
  assert.equal(safeOrganizationNext("/admin/security"), "/admin/security");
  assert.equal(safeOrganizationNext("/new"), "/new");
  assert.equal(safeOrganizationNext("/start"), "/admin");
  assert.equal(safeOrganizationNext("/login"), "/admin");
  assert.equal(safeOrganizationNext("/join#token=secret"), "/admin");
  assert.equal(safeOrganizationNext("/reset#token=secret"), "/admin");
  assert.equal(safeOrganizationNext("https://evil.example/admin"), "/admin");
  assert.equal(safeOrganizationNext("//evil.example/admin"), "/admin");
  assert.equal(safeOrganizationNext("/%2f%2fevil.example"), "/admin");
});

test("campaign id extraction is strict and decoded", () => {
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/campaign_abc-123"), "campaign_abc-123");
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/campaign%3Aabc"), "campaign:abc");
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/a/b"), null);
  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/%2F%2Fevil"), null);
});
