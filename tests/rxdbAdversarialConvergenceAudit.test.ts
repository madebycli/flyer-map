import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { deriveMutationFromRxdbWrite } from "../src/domain/rxdbMutationAdapter.ts";
import type { RxdbCollectionName, RxdbDocument, RxdbPushRow } from "../src/data/rxdbSyncProtocol.ts";

const campaignId = "campaign_adversarial_convergence";
const timestamp = "2026-09-07T13:17:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 12,
    campaign: {
      id: campaignId,
      name: "Audit Mission",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [{
      id: "team_a",
      campaignId,
      name: "Team A",
      color: "#2563eb",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    areas: [{
      id: "area_a",
      campaignId,
      teamId: "team_a",
      name: "Area A",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.60, 49.40], [8.70, 49.40], [8.70, 49.50], [8.60, 49.40]]],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    tasks: [{
      id: "task_a",
      campaignId,
      areaId: "area_a",
      taskType: "street",
      label: "Street A",
      geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] },
      source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [101] },
      areaPreparationGeneration: "generation_a",
      status: "open",
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    houseTasks: [{
      id: "house_a",
      campaignId,
      areaId: "area_a",
      taskType: "house",
      label: "House A",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.611, 49.411], [8.612, 49.411], [8.612, 49.412], [8.611, 49.411]]],
      },
      source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [202] },
      areaPreparationGeneration: "generation_a",
      parentStreetTaskId: "task_a",
      status: "open",
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  };
}

function row(assumedMasterState: RxdbDocument | undefined, newDocumentState: RxdbDocument): RxdbPushRow {
  return { assumedMasterState, newDocumentState } as RxdbPushRow;
}

function entityDocument(collectionName: RxdbCollectionName, value: CampaignSnapshot): RxdbDocument {
  if (collectionName === "teams") return value.teams[0] as RxdbDocument;
  if (collectionName === "areas") return value.areas[0] as RxdbDocument;
  if (collectionName === "streetTasks") return value.tasks[0] as RxdbDocument;
  if (collectionName === "houseTasks") return value.houseTasks![0] as RxdbDocument;
  return { ...value.campaign, campaignId: value.campaign.id } as RxdbDocument;
}

test("stale updates cannot resurrect entities already deleted on the server", () => {
  for (const collectionName of ["teams", "areas", "streetTasks", "houseTasks"] as const) {
    const before = snapshot();
    const assumed = entityDocument(collectionName, before);
    const next = { ...assumed, label: "stale client write", name: "stale client write" } as RxdbDocument;
    const current: CampaignSnapshot = {
      ...before,
      teams: collectionName === "teams" ? [] : before.teams,
      areas: collectionName === "areas" ? [] : before.areas,
      tasks: collectionName === "streetTasks" ? [] : before.tasks,
      houseTasks: collectionName === "houseTasks" ? [] : before.houseTasks,
    };

    const decision = deriveMutationFromRxdbWrite(collectionName, current, row(assumed, next), timestamp);
    assert.deepEqual(decision, { kind: "conflict", reason: "target_deleted" }, `${collectionName} must not resurrect after canonical delete`);
  }
});

test("street clients cannot rewrite server-owned structural fields", () => {
  const current = snapshot();
  const assumed = current.tasks[0] as RxdbDocument;
  const variants: Array<[string, RxdbDocument]> = [
    ["areaId", { ...assumed, areaId: "area_other" } as RxdbDocument],
    ["geometry", { ...assumed, geometry: { type: "LineString", coordinates: [[9, 50], [9.1, 50.1]] } } as RxdbDocument],
    ["source", { ...assumed, source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [999] } } as RxdbDocument],
    ["generation", { ...assumed, areaPreparationGeneration: "forged_generation" } as RxdbDocument],
  ];

  for (const [field, next] of variants) {
    const decision = deriveMutationFromRxdbWrite("streetTasks", current, row(assumed, next), timestamp);
    assert.deepEqual(decision, { kind: "conflict", reason: "task_structural_change" }, `street ${field} must remain server-owned`);
  }
});

test("house clients cannot rewrite server-owned structural fields or parent relation", () => {
  const current = snapshot();
  const assumed = current.houseTasks![0] as RxdbDocument;
  const variants: Array<[string, RxdbDocument]> = [
    ["areaId", { ...assumed, areaId: "area_other" } as RxdbDocument],
    ["geometry", { ...assumed, geometry: { type: "Polygon", coordinates: [[[9, 50], [9.1, 50], [9.1, 50.1], [9, 50]]] } } as RxdbDocument],
    ["source", { ...assumed, source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [777] } } as RxdbDocument],
    ["generation", { ...assumed, areaPreparationGeneration: "forged_generation" } as RxdbDocument],
    ["parentStreetTaskId", { ...assumed, parentStreetTaskId: "task_other" } as RxdbDocument],
  ];

  for (const [field, next] of variants) {
    const decision = deriveMutationFromRxdbWrite("houseTasks", current, row(assumed, next), timestamp);
    assert.deepEqual(decision, { kind: "conflict", reason: "house_structural_change" }, `house ${field} must remain server-owned`);
  }
});

test("compound user-field changes are rejected instead of being partially applied", () => {
  const current = snapshot();
  const assumedStreet = current.tasks[0] as RxdbDocument;
  const nextStreet = {
    ...assumedStreet,
    label: "Street renamed",
    status: "completed",
    completedAt: "2026-09-07T13:18:00.000Z",
  } as RxdbDocument;
  assert.deepEqual(
    deriveMutationFromRxdbWrite("streetTasks", current, row(assumedStreet, nextStreet), timestamp),
    { kind: "conflict", reason: "task_compound_change" },
  );

  const assumedHouse = current.houseTasks![0] as RxdbDocument;
  const nextHouse = {
    ...assumedHouse,
    label: "House renamed",
    status: "completed",
    completedAt: "2026-09-07T13:18:00.000Z",
  } as RxdbDocument;
  assert.deepEqual(
    deriveMutationFromRxdbWrite("houseTasks", current, row(assumedHouse, nextHouse), timestamp),
    { kind: "conflict", reason: "house_compound_change" },
  );
});

test("stale writes to the same user-owned field conflict against newer canonical state", () => {
  const base = snapshot();
  const assumedStreet = base.tasks[0] as RxdbDocument;
  const currentStreet = {
    ...base.tasks[0],
    status: "later" as const,
    updatedAt: "2026-09-07T13:19:00.000Z",
  };
  const current: CampaignSnapshot = { ...base, tasks: [currentStreet] };
  const next = {
    ...assumedStreet,
    status: "completed",
    completedAt: "2026-09-07T13:20:00.000Z",
  } as RxdbDocument;

  assert.deepEqual(
    deriveMutationFromRxdbWrite("streetTasks", current, row(assumedStreet, next), timestamp),
    { kind: "conflict", reason: "task_status_changed" },
  );
});

test("RxDB transport metadata cannot turn a no-op into an authoritative write", () => {
  const current = snapshot();
  const canonical = current.tasks[0] as RxdbDocument;
  const next = {
    ...canonical,
    _rev: "999-forged",
    _meta: { lwt: Number.MAX_SAFE_INTEGER },
    _attachments: { secret: { digest: "forged" } },
  } as RxdbDocument;

  assert.deepEqual(
    deriveMutationFromRxdbWrite("streetTasks", current, row(canonical, next), timestamp),
    { kind: "ack" },
  );
});
