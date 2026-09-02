import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("normal mission sync is RxDB-first and retains the M5 queue only for one-time import", async () => {
  const store = await readFile("src/data/campaignStore.ts", "utf8");
  assert.match(store, /MissionRxdbSync/u);
  assert.match(store, /migrateLegacyM5Records/u);
  assert.match(store, /await browserMutationQueue\.list\(campaignId\);/u);
  assert.match(store, /await browserMutationQueue\.remove\(record\.id\);/u);
  assert.doesNotMatch(store, /processMutationQueue\(/u);
  assert.doesNotMatch(store, /POLL_INTERVAL_MS/u);
  assert.match(store, /collectionModeFromUrl\(\) && mutation\.type\.startsWith\("collection\."\)/u);
  assert.match(store, /postCampaignMutation\(snapshot\.campaign\.id, mutation/u);
});

test("replica snapshots are locally materialized and interaction deferral remains explicit", async () => {
  const store = await readFile("src/data/campaignStore.ts", "utf8");
  assert.match(store, /function applyRxdbSnapshot/u);
  assert.match(store, /runtime\.deferredSnapshot = normalized/u);
  assert.match(store, /syncState: runtime\.pendingWrites > 0 \? "pending" : "saved"/u);
  assert.match(store, /runtime\.sync\.applyMutation\(mutation\)/u);
});
