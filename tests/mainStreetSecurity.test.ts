import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, networkOsm, seedNetwork } from "./helpers/networkD1.ts";
import { prepareAreaTasks } from "../worker/areaTaskPreparation.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleNetworkIntent } from "../worker/streetNetwork/api.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import { handleRxdbPush } from "../worker/rxdbSync.ts";
import { legacySnapshotWriteResponse } from "../worker/index.ts";

const admin = { campaignId: "campaign_n", role: "admin" as const, teamId: null, label: null, grantId: "security" };
const request = (value: unknown) => new Request("https://example.test/api/campaigns/campaign_n/network", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

async function prepared() {
  const db = new NetworkD1();
  seedNetwork(db);
  const result = await prepareAreaTasks(db, "campaign_n", "area_n", { fetchImpl: async () => networkOsm() });
  assert.equal(result.outcome, "ready");
  return db;
}

async function intentFor(db: NetworkD1, id = "network_security") {
  const snapshot = (await loadCampaignSnapshot(db, "campaign_n"))!;
  const task = snapshot.tasks[0];
  return {
    id,
    areaId: "area_n",
    generation: task.areaPreparationGeneration!,
    start: { point: [13.0015, 51.005] as [number, number], taskId: task.id },
    end: { point: [13.006, 51.005] as [number, number], taskId: task.id },
    selectedPath: [task.id],
    status: "completed" as const,
  };
}

function mutationRequest(mutation: unknown) {
  return new Request("https://example.test/api/campaigns/campaign_n/mutations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  });
}

test("Street network rejects foreign campaign, viewer and wrong-team writes", async () => {
  const db = await prepared();
  const intent = await intentFor(db);
  assert.equal((await handleNetworkIntent(request(intent), db, "campaign_n", { ...admin, campaignId: "campaign_other" })).status, 403);
  assert.equal((await handleNetworkIntent(request(intent), db, "campaign_n", { ...admin, role: "viewer" })).status, 403);
  assert.equal((await handleNetworkIntent(request(intent), db, "campaign_n", { ...admin, role: "team-editor", teamId: "team_other" })).status, 403);
});

test("Street network rejects manipulated Area and Street ids, reused intent id and stale generation", async () => {
  const db = await prepared();
  const intent = await intentFor(db);
  assert.equal((await handleNetworkIntent(request({ ...intent, areaId: "area_foreign" }), db, "campaign_n", admin)).status, 404);
  assert.equal((await handleNetworkIntent(request({ ...intent, selectedPath: ["task_foreign"] }), db, "campaign_n", admin)).status, 409);
  assert.equal((await handleNetworkIntent(request({ ...intent, generation: "stale_generation" }), db, "campaign_n", admin)).status, 409);

  const first = await handleNetworkIntent(request(intent), db, "campaign_n", admin);
  assert.equal(first.status, 200, await first.clone().text());
  const reused = await handleNetworkIntent(request({ ...intent, status: "later" }), db, "campaign_n", admin);
  assert.equal(reused.status, 409);
  assert.equal(((await reused.json()) as { code: string }).code, "intent_id_reused");
});

test("House mutation rejects a manipulated House id and stale entity revision", async () => {
  const db = await prepared();
  const snapshot = (await loadCampaignSnapshot(db, "campaign_n"))!;
  const house = snapshot.houseTasks![0];

  const forged = await handleCampaignMutation(mutationRequest({
    id: "mutation_house_forged",
    campaignId: "campaign_n",
    baseRevision: snapshot.revision,
    createdAt: "2026-09-08T12:00:00.000Z",
    type: "house.set-status",
    payload: { taskId: "task_house_foreign", status: "completed", completedAt: "2026-09-08T12:00:00.000Z", expectedUpdatedAt: house.updatedAt },
  }), db, "campaign_n", admin);
  assert.equal(forged.status, 409);

  const stale = await handleCampaignMutation(mutationRequest({
    id: "mutation_house_stale",
    campaignId: "campaign_n",
    baseRevision: Math.max(0, snapshot.revision - 1),
    createdAt: "2026-09-08T12:01:00.000Z",
    type: "house.set-status",
    payload: { taskId: house.id, status: "completed", completedAt: "2026-09-08T12:01:00.000Z", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
  }), db, "campaign_n", admin);
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, "mutation_conflict");
});

test("Viewer RxDB push is denied and the old snapshot writer stays retired", async () => {
  const db = await prepared();
  const push = await handleRxdbPush(db, "campaign_n", "houseTasks", { ...admin, role: "viewer" }, { rows: [] });
  assert.equal(push.status, 403);
  assert.equal(((await push.json()) as { error: { code: string } }).error.code, "viewer_read_only");

  const legacy = legacySnapshotWriteResponse();
  assert.equal(legacy.status, 410);
  assert.equal(((await legacy.json()) as { error: { code: string } }).error.code, "legacy_snapshot_write_retired");
});
