import assert from "node:assert/strict";
import test from "node:test";
import type { AccessInfo } from "../src/data/campaignApi.ts";
import {
  appMenuModules,
  availableAppMenuModules,
} from "../src/navigation/appMenuModel.ts";

function access(role: AccessInfo["role"]): AccessInfo {
  return {
    campaignId: "campaign_menu",
    role,
    teamId: role === "team-editor" ? "team_a" : null,
    label: null,
  };
}

test("field modules stay visible independent of write role", () => {
  const viewerIds = appMenuModules(access("viewer")).map((module) => module.id);
  const editorIds = appMenuModules(access("team-editor")).map((module) => module.id);
  assert.deepEqual(viewerIds, editorIds);
  assert.deepEqual(viewerIds, [
    "progress",
    "teams",
    "activity",
    "collection",
    "support",
    "settings",
  ]);
});

test("admin entry is shown only for current admin access and remains planned", () => {
  const adminModules = appMenuModules(access("admin"));
  const admin = adminModules.find((module) => module.id === "admin");
  assert.deepEqual(admin, { id: "admin", state: "planned", requiresAdmin: true });
  assert.equal(appMenuModules(access("viewer")).some((module) => module.id === "admin"), false);
});

test("planned modules are never reported as available", () => {
  assert.deepEqual(
    availableAppMenuModules(access("viewer")).map((module) => module.id),
    ["progress", "teams", "support", "settings"],
  );
});

test("missing access does not accidentally expose admin entry", () => {
  assert.equal(appMenuModules(null).some((module) => module.id === "admin"), false);
});
