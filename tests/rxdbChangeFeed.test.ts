import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  rxdbChangeFeedEntriesForMutation,
  rxdbChangeFeedEntriesForSnapshotDelta,
} from "../worker/rxdbChangeFeed.ts";

const stamp = "2026-09-02T09:00:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 1,
    campaign: { id: "campaign_feed", name: "Mission", status: "active", defaultMapView: null, createdAt: stamp, updatedAt: stamp },
    teams: [{ id: "team_a", campaignId: "campaign_feed", name: "Team A", color: "#2563eb", createdAt: stamp, updatedAt: stamp }],
    areas: [{ id: "area_a", campaignId: "campaign_feed", teamId: "team_a", name: "Gebiet", geometry: { type: "Polygon", coordinates: [[[8.6, 49.4], [8.61, 49.4], [8.61, 49.41], [8.6, 49.4]]] }, createdAt: stamp, updatedAt: stamp }],
    tasks: [{ id: "task_a", campaignId: "campaign_feed", areaId: "area_a", taskType: "street", label: "Straße", geometry: { type: "LineString", coordinates: [[8.6, 49.4], [8.61, 49.41]] }, status: "open", completedAt: null, createdAt: stamp, updatedAt: stamp }],
    houseTasks: [],
  };
}

test("a Street status produces one scoped incremental upsert", () => {
  const before = snapshot();
  const after: CampaignSnapshot = {
    ...before,
    revision: 2,
    tasks: before.tasks.map((task) => ({ ...task, status: "completed", completedAt: "2026-09-02T09:01:00.000Z", updatedAt: "2026-09-02T09:01:00.000Z" })),
  };
  const entries = rxdbChangeFeedEntriesForMutation(before, after, {
    id: "mutation_status",
    campaignId: before.campaign.id,
    baseRevision: 1,
    createdAt: "2026-09-02T09:01:00.000Z",
    type: "task.set-status",
    payload: { taskId: "task_a", status: "completed", completedAt: "2026-09-02T09:01:00.000Z", expectedUpdatedAt: stamp },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].collectionName, "streetTasks");
  assert.equal(entries[0].scopeTeamId, "team_a");
  assert.equal(entries[0].document._deleted, undefined);
});

test("Area deletion emits tombstones for its dependent Streets", () => {
  const before = snapshot();
  const after: CampaignSnapshot = { ...before, revision: 2, areas: [], tasks: [], houseTasks: [] };
  const entries = rxdbChangeFeedEntriesForMutation(before, after, {
    id: "mutation_area-delete",
    campaignId: before.campaign.id,
    baseRevision: 1,
    createdAt: "2026-09-02T09:01:00.000Z",
    type: "area.delete",
    payload: { areaId: "area_a", expectedUpdatedAt: stamp },
  });

  assert.deepEqual(entries.map((entry) => [entry.collectionName, entry.document.id, entry.document._deleted, entry.scopeTeamId]), [
    ["areas", "area_a", true, "team_a"],
    ["streetTasks", "task_a", true, "team_a"],
  ]);
});

test("House completion includes an automatic parent Street upsert", () => {
  const before = snapshot();
  before.houseTasks = [{
    id: "house_a",
    campaignId: before.campaign.id,
    areaId: "area_a",
    taskType: "house",
    label: "Haus",
    geometry: { type: "Polygon", coordinates: [[[8.6, 49.4], [8.601, 49.4], [8.601, 49.401], [8.6, 49.4]]] },
    areaPreparationGeneration: null,
    parentStreetTaskId: "task_a",
    status: "open",
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }];
  const after: CampaignSnapshot = {
    ...before,
    revision: 2,
    tasks: before.tasks.map((task) => ({ ...task, status: "completed", completedAt: "2026-09-02T09:01:00.000Z", updatedAt: "2026-09-02T09:01:00.000Z" })),
    houseTasks: before.houseTasks.map((task) => ({ ...task, status: "completed", completedAt: "2026-09-02T09:01:00.000Z", updatedAt: "2026-09-02T09:01:00.000Z" })),
  };
  const entries = rxdbChangeFeedEntriesForMutation(before, after, {
    id: "mutation_house-status",
    campaignId: before.campaign.id,
    baseRevision: 1,
    createdAt: "2026-09-02T09:01:00.000Z",
    type: "house.set-status",
    payload: { taskId: "house_a", status: "completed", completedAt: "2026-09-02T09:01:00.000Z", expectedUpdatedAt: stamp },
  });

  assert.deepEqual(entries.map((entry) => [entry.collectionName, entry.document.id]), [
    ["houseTasks", "house_a"],
    ["streetTasks", "task_a"],
  ]);
});

test("Area reassignment tombstones the old Field Group scope and upserts the new one", () => {
  const before = snapshot();
  const after: CampaignSnapshot = {
    ...before,
    revision: 2,
    areas: before.areas.map((area) => ({ ...area, teamId: "team_b", updatedAt: "2026-09-02T09:02:00.000Z" })),
  };
  after.teams = [...before.teams, { id: "team_b", campaignId: before.campaign.id, name: "Team B", color: "#ea580c", createdAt: stamp, updatedAt: stamp }];
  const entries = rxdbChangeFeedEntriesForMutation(before, after, {
    id: "mutation_area-team",
    campaignId: before.campaign.id,
    baseRevision: 1,
    createdAt: "2026-09-02T09:02:00.000Z",
    type: "area.set-team",
    payload: { areaId: "area_a", teamId: "team_b", expectedUpdatedAt: stamp },
  });

  assert.deepEqual(entries.map((entry) => [entry.collectionName, entry.document.id, entry.document._deleted, entry.scopeTeamId]), [
    ["areas", "area_a", true, "team_a"],
    ["areas", "area_a", undefined, "team_b"],
    ["streetTasks", "task_a", true, "team_a"],
    ["streetTasks", "task_a", undefined, "team_b"],
  ]);
});

test("server-owned preparation emits automatic task upserts and tombstones", () => {
  const before = snapshot();
  before.tasks[0] = {
    ...before.tasks[0],
    areaPreparationGeneration: "old-generation",
  };
  const after: CampaignSnapshot = {
    ...before,
    revision: 2,
    tasks: [{
      ...before.tasks[0],
      id: "task_new",
      label: "Neue Straße",
      areaPreparationGeneration: "new-generation",
      createdAt: "2026-09-02T09:02:00.000Z",
      updatedAt: "2026-09-02T09:02:00.000Z",
    }],
  };
  const entries = rxdbChangeFeedEntriesForSnapshotDelta(before, after);
  assert.deepEqual(entries.map((entry) => [entry.collectionName, entry.document.id, entry.document._deleted]), [
    ["streetTasks", "task_a", true],
    ["streetTasks", "task_new", undefined],
  ]);
});
