import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Collection Admin exposes the four narrow Pickup capability controls", () => {
  const panel = readFileSync(new URL("../src/collection/CollectionAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /canViewPickups/u);
  assert.match(panel, /canCreatePickups/u);
  assert.match(panel, /canEditPickups/u);
  assert.match(panel, /canAssignPickups/u);
  assert.match(panel, /updateCollectionPickupCapabilities/u);
  assert.match(panel, /key === "canViewPickups" && !checked/u);
});

test("Pickup capability client uses the narrow same-origin collector endpoint", () => {
  const client = readFileSync(new URL("../src/data/pickupCapabilitiesApi.ts", import.meta.url), "utf8");
  assert.match(client, /\/collection\/collectors\//u);
  assert.match(client, /\/pickup-capabilities/u);
  assert.match(client, /credentials: "same-origin"/u);
  assert.doesNotMatch(client, /apiKey|token_hash|session_hash/u);
});
