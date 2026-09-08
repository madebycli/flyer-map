import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, networkOsm, seedNetwork } from "./helpers/networkD1.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import { prepareAreaTasks } from "../worker/areaTaskPreparation.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleRxdbPull } from "../worker/rxdbSync.ts";

const access = { grantId: "product-flow", campaignId: "campaign_n", role: "admin" as const, teamId: null, label: null };

function mutationRequest(mutation: unknown) {
  return new Request("https://example.test/api/campaigns/campaign_n/mutations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  });
}

test("Area create can flow into authoritative server Street/House preparation and RxDB pull", async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  db.sqlite.prepare("DELETE FROM areas WHERE id = 'area_n'").run();

  const geometry = {
    type: "Polygon" as const,
    coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
  };
  const createdAt = "2026-09-08T11:00:00.000Z";
  const create = await handleCampaignMutation(mutationRequest({
    id: "mutation_main-street-product-area",
    campaignId: "campaign_n",
    baseRevision: 1,
    createdAt,
    type: "area.create",
    payload: { areaId: "area_n", teamId: "team_n", name: "Area", geometry },
  }), db, "campaign_n", access);
  assert.equal(create.status, 200, await create.clone().text());

  const prepared = await prepareAreaTasks(db, "campaign_n", "area_n", {
    fetchImpl: async () => networkOsm(),
  });
  assert.equal(prepared.outcome, "ready");

  const snapshot = await loadCampaignSnapshot(db, "campaign_n");
  assert.ok(snapshot);
  assert.equal(snapshot.areas.some((area) => area.id === "area_n"), true);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.houseTasks?.length, 3);
  assert.ok(snapshot.tasks[0].areaPreparationGeneration);
  assert.equal(snapshot.houseTasks?.every((house) => house.parentStreetTaskId === snapshot.tasks[0].id), true);

  const streetPull = await handleRxdbPull(db, "campaign_n", "tasks", access, { batchSize: 100 });
  assert.equal(streetPull.status, 200);
  const streetBody = await streetPull.json() as { documents: Array<{ id: string }> };
  assert.equal(streetBody.documents.some((document) => document.id === snapshot.tasks[0].id), true);

  const housePull = await handleRxdbPull(db, "campaign_n", "houseTasks", access, { batchSize: 100 });
  assert.equal(housePull.status, 200);
  const houseBody = await housePull.json() as { documents: Array<{ id: string }> };
  assert.equal(houseBody.documents.length, 3);
});
