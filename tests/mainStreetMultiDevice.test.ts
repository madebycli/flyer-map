import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, networkOsm, seedNetwork } from "./helpers/networkD1.ts";
import { prepareAreaTasks } from "../worker/areaTaskPreparation.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleNetworkIntent } from "../worker/streetNetwork/api.ts";
import { handleRxdbCheckpoint, handleRxdbPull } from "../worker/rxdbSync.ts";

const access = { campaignId: "campaign_n", role: "admin" as const, teamId: null, label: null, grantId: "multi-device" };

async function prepared() {
  const db = new NetworkD1();
  seedNetwork(db);
  const result = await prepareAreaTasks(db, "campaign_n", "area_n", { fetchImpl: async () => networkOsm() });
  assert.equal(result.outcome, "ready");
  return db;
}

async function json<T>(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<T>;
}

test("two Street/House clients catch up from the same checkpoint and visibly converge after reconnect", async () => {
  const db = await prepared();
  const initialStreet = await json<{ documents: unknown[]; checkpoint: { seq: number } }>(
    await handleRxdbPull(db, "campaign_n", "streetTasks", access, { batchSize: 100 }),
  );
  const initialHouse = await json<{ documents: unknown[]; checkpoint: { seq: number } }>(
    await handleRxdbPull(db, "campaign_n", "houseTasks", access, { batchSize: 100 }),
  );
  assert.equal(initialStreet.documents.length, 1);
  assert.equal(initialHouse.documents.length, 3);
  assert.equal(initialStreet.checkpoint.seq, initialHouse.checkpoint.seq);

  const snapshot = (await loadCampaignSnapshot(db, "campaign_n"))!;
  const task = snapshot.tasks[0];
  const intent = {
    id: "network_multi-device",
    areaId: "area_n",
    generation: task.areaPreparationGeneration!,
    start: { point: [13.0015, 51.005] as [number, number], taskId: task.id },
    end: { point: [13.006, 51.005] as [number, number], taskId: task.id },
    selectedPath: [task.id],
    status: "completed" as const,
  };
  const committed = await handleNetworkIntent(new Request("https://example.test/api/campaigns/campaign_n/network", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intent),
  }), db, "campaign_n", access);
  assert.equal(committed.status, 200, await committed.clone().text());

  const catchUp = async (collectionName: "streetTasks" | "houseTasks", checkpoint: { seq: number }) =>
    json<{ documents: unknown[]; checkpoint: { seq: number }; campaignRevision: number }>(
      await handleRxdbPull(db, "campaign_n", collectionName, access, { checkpoint, batchSize: 100 }),
    );

  const [aStreet, aHouse] = await Promise.all([
    catchUp("streetTasks", initialStreet.checkpoint),
    catchUp("houseTasks", initialHouse.checkpoint),
  ]);
  // Client B represents a late reconnect from the exact same persisted local checkpoint.
  const [bStreet, bHouse] = await Promise.all([
    catchUp("streetTasks", initialStreet.checkpoint),
    catchUp("houseTasks", initialHouse.checkpoint),
  ]);

  assert.deepEqual(bStreet, aStreet);
  assert.deepEqual(bHouse, aHouse);
  assert.equal(aStreet.documents.length, 1);
  assert.equal(aHouse.documents.length, 2);
  assert.equal(aStreet.checkpoint.seq, aHouse.checkpoint.seq);

  const canonical = await json<{ checkpoint: { seq: number }; campaignRevision: number }>(
    await handleRxdbCheckpoint(db, "campaign_n", access),
  );
  assert.equal(aStreet.checkpoint.seq, canonical.checkpoint.seq);
  assert.equal(aHouse.checkpoint.seq, canonical.checkpoint.seq);
  assert.equal(aStreet.campaignRevision, canonical.campaignRevision);
  assert.equal(aHouse.campaignRevision, canonical.campaignRevision);
});
