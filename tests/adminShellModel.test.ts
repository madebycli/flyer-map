import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SHELL_MODULES,
  adminModuleById,
} from "../src/admin/adminShellModel.ts";

test("Admin shell keeps account/security and collaboration modules visibly planned", () => {
  assert.equal(adminModuleById("security")?.state, "planned");
  assert.equal(adminModuleById("collaboration")?.state, "planned");
});

test("current Campaign management surfaces may be represented without inventing new authorization", () => {
  assert.equal(adminModuleById("teams")?.state, "available");
  assert.equal(adminModuleById("areas")?.state, "available");
  assert.equal(adminModuleById("access")?.state, "available");
});

test("Admin module ids are unique", () => {
  const ids = ADMIN_SHELL_MODULES.map((module) => module.id);
  assert.equal(new Set(ids).size, ids.length);
});
