import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mission sync removes terminal records, then refreshes the canonical server snapshot", async () => {
  const store = await readFile("src/data/campaignStore.ts", "utf8");
  assert.match(store, /const POLL_INTERVAL_MS = 3_000/u);
  assert.match(store, /record\.state === "conflict" \|\| record\.state === "invalid"/u);
  assert.match(store, /await browserMutationQueue\.remove\(record\.id\);/u);
  assert.match(store, /terminalServerWinsIssue\(record, "http_409"/u);
  assert.match(store, /await processMutationQueue\(\);/u);
  assert.doesNotMatch(store, /queueMicrotask\(\(\) => void processMutationQueue\(\)\)/u);
});

test("a stale cache with no queued mutation is saved state, not a user conflict", async () => {
  const store = await readFile("src/data/campaignStore.ts", "utf8");
  const staleCache = store.slice(store.indexOf("const sameContent"), store.indexOf("async function initializeSharedPersistence"));
  assert.match(staleCache, /applyServerSnapshot\(serverSnapshot\);/u);
  assert.match(staleCache, /syncState: "saved"/u);
  assert.doesNotMatch(staleCache, /saveCampaignConflictSnapshot\(latestLocal\)/u);
  assert.doesNotMatch(staleCache, /messageCode: "conflict"/u);
});
