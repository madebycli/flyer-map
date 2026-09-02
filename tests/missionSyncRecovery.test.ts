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

test("replica snapshots and sync status distinguish local persistence from server acknowledgement", async () => {
  const [store, sync] = await Promise.all([
    readFile("src/data/campaignStore.ts", "utf8"),
    readFile("src/data/rxdbMissionSync.ts", "utf8"),
  ]);
  assert.match(store, /function applyRxdbSnapshot/u);
  assert.match(store, /runtime\.deferredSnapshot = normalized/u);
  assert.match(store, /"local-saved" \| "waiting-server" \| "server-confirmed"/u);
  assert.match(store, /await sync\.refreshAndWait\(\)/u);
  assert.match(store, /syncState: "server-confirmed"/u);
  assert.doesNotMatch(store, /runtime\.pendingWrites > 0 \? "pending" : "saved"/u);
  assert.doesNotMatch(store, /window\.setTimeout\([\s\S]{0,500}250/u);
  assert.match(store, /runtime\.sync\.applyMutation\(mutation\)/u);
  assert.match(sync, /allCollectionsAtOrBeyond/u);
  assert.match(sync, /rxdb_refresh_timeout/u);
  assert.doesNotMatch(sync, /awaitInSync\(/u);
});

test("Field Group replicas are actor-scoped in addition to Team scope", async () => {
  const [store, sync] = await Promise.all([
    readFile("src/data/campaignStore.ts", "utf8"),
    readFile("src/data/rxdbMissionSync.ts", "utf8"),
  ]);
  assert.match(store, /actorScopeId = fieldGroupAccess\?\.groupId/u);
  assert.match(store, /field_group_actor_scope_required/u);
  assert.match(store, /if \(runtime\.sync\) await runtime\.sync\.destroy\(\)/u);
  assert.match(store, /collectionFallback: fieldGroupAccess \? undefined : runtime\.latestLocal\?\.collection/u);
  assert.match(sync, /replicaScope = this\.actorScopeId/u);
  assert.match(sync, /-actor-/u);
  assert.match(sync, /replicationIdentifier: "mission-rxdb-sync-v1:" \+ this\.campaignId \+ ":" \+ this\.replicaScope/u);
});
