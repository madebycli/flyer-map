import assert from "node:assert/strict";
import test from "node:test";
import { liveGroupCreationDefaults } from "../src/live/liveGroupDefaults.ts";

test("new live groups default to active and visible in the action list", () => {
  assert.deepEqual(liveGroupCreationDefaults(), {
    discoverable: true,
    state: "active",
  });
});

test("creation defaults contain no join credentials or authority", () => {
  const serialized = JSON.stringify(liveGroupCreationDefaults());
  assert.equal(serialized.includes("code"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("admin"), false);
  assert.equal(serialized.includes("organizer"), false);
});
