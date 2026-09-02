import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MissionRxdbSync } from "../src/data/rxdbMissionSync.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";

const collectionNames: RxdbCollectionName[] = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"];

test("safety resync uses the slowest collection checkpoint", async () => {
  const sync = new MissionRxdbSync({
    campaignId: "campaign_checkpoint_safety",
    storage: {},
    multiInstance: false,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  const internal = sync as unknown as {
    initialized: boolean;
    canonicalRevision: number;
    checkpoints: Map<RxdbCollectionName, number>;
    replications: Map<RxdbCollectionName, { reSync(): void }>;
    requestCheckpoint(): Promise<{ seq: number; campaignRevision: number }>;
    minimumKnownCheckpoint(): number;
  };
  internal.initialized = true;
  internal.canonicalRevision = 12;
  internal.checkpoints.set("campaigns", 120);
  internal.checkpoints.set("teams", 120);
  internal.checkpoints.set("areas", 120);
  internal.checkpoints.set("houseTasks", 120);
  internal.checkpoints.set("streetTasks", 105);
  assert.equal(internal.minimumKnownCheckpoint(), 105);

  let resyncCalls = 0;
  for (const name of collectionNames) {
    internal.replications.set(name, { reSync: () => { resyncCalls += 1; } });
  }
  internal.requestCheckpoint = async () => ({ seq: 120, campaignRevision: 12 });
  await sync.safetyResync();
  assert.equal(resyncCalls, 5, "one lagging collection must force all independent replications to retry");

  internal.checkpoints.set("streetTasks", 120);
  await sync.safetyResync();
  assert.equal(resyncCalls, 5, "no redundant safety resync once every collection reached the high-water");
});

test("missing collection checkpoint is treated as zero until it has pulled", () => {
  const sync = new MissionRxdbSync({
    campaignId: "campaign_checkpoint_bootstrap",
    storage: {},
    multiInstance: false,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  const internal = sync as unknown as {
    checkpoints: Map<RxdbCollectionName, number>;
    minimumKnownCheckpoint(): number;
  };
  internal.checkpoints.set("campaigns", 50);
  internal.checkpoints.set("teams", 50);
  internal.checkpoints.set("areas", 50);
  internal.checkpoints.set("houseTasks", 50);
  assert.equal(internal.minimumKnownCheckpoint(), 0);
});

test("push success is only acknowledged when the post-commit master matches the requested business state", async () => {
  const worker = await readFile("worker/rxdbSync.ts", "utf8");
  assert.match(worker, /const canonical = await loadCampaignSnapshot\(db, campaignId\);\s*const master = currentDocument\(canonical, collectionName, next\.id, next\);\s*if \(sameBusinessDocument\(master, next\)\) continue;/u);
  assert.match(worker, /conflicts\.push\(canReadDocument\(access, collectionName, master, canonical\)/u);
});

test("Cloudflare Durable Object namespace is provisioned as SQLite and entrypoint exports the class", async () => {
  const wrangler = await readFile("wrangler.jsonc", "utf8");
  const entrypoint = await readFile("worker/indexFc52.ts", "utf8");
  assert.match(wrangler, /"new_sqlite_classes"\s*:\s*\["CampaignSyncDurableObject"\]/u);
  assert.doesNotMatch(wrangler, /"new_classes"\s*:/u);
  assert.match(entrypoint, /export \{ CampaignSyncDurableObject \} from "\.\/campaignSyncDurableObject\.ts";/u);
});
