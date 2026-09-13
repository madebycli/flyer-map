import assert from "node:assert/strict";
import test from "node:test";
import { roadLength, RoadIndex, networkRoutes, type RoadSnap } from "../src/domain/streetNetwork.ts";
import type { DistributionTask } from "../src/domain/campaign.ts";
import {
  createPickupRoadSectionFromSelection,
  verifyPickupRoadSectionAgainstDistribution,
} from "../src/collection/pickupStreetEngineAdapter.ts";

const geometry = { type: "LineString" as const, coordinates: [[13, 51], [13.02, 51]] as [number, number][] };
const task: DistributionTask = {
  id: "task_network_pickup",
  campaignId: "campaign_pickup_adapter",
  areaId: "collection_area_adapter",
  taskType: "street",
  label: "Hauptstraße",
  geometry,
  source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [9001] },
  areaPreparationGeneration: "generation_adapter",
  network: { fromNode: "node_a", toNode: "node_b", length: roadLength(geometry), coverage: [] },
  status: "open",
  completedAt: null,
  createdAt: "2026-09-13T10:00:00.000Z",
  updatedAt: "2026-09-13T10:00:00.000Z",
};

function selection() {
  const tasks = [task];
  const index = new RoadIndex(tasks);
  const points = [13.001, 13.004, 13.007, 13.010, 13.013, 13.017].map((longitude) => {
    const snap = index.candidates([longitude, 51])[0];
    assert.ok(snap);
    return snap;
  });
  const legs = points.slice(1).map((point, index) => ({
    routes: networkRoutes(tasks, points[index], point),
    selected: 0,
  }));
  return { tasks, points: points as RoadSnap[], legs };
}

test("Pickup adapter keeps six real waypoints and copies only reviewed StreetEngine output", async () => {
  const { tasks, points, legs } = selection();
  const before = JSON.stringify(tasks[0].network);
  const section = await createPickupRoadSectionFromSelection({
    campaignId: "campaign_pickup_adapter",
    areaId: "collection_area_adapter",
    sectionId: "collection_section_adapter",
    label: "Nordroute",
    points,
    legs,
  }, tasks);
  assert.equal(section.smartMarking?.via.length, 4);
  assert.equal(section.smartMarking?.paths.length, 5);
  assert.equal(section.smartMarking?.selectedPath.length, 5);
  assert.deepEqual(section.source, { dataset: "OpenStreetMap", objectType: "way", objectIds: [9001] });
  assert.equal(section.sourceTaskId, task.id);
  assert.deepEqual(section.coverage, []);
  assert.equal(JSON.stringify(tasks[0].network), before, "adapter must not mutate Distribution coverage");
  assert.equal((await verifyPickupRoadSectionAgainstDistribution(section, tasks)).valid, true);
});

test("Pickup adapter detects current StreetEngine state changes without changing pickup progress", async () => {
  const { tasks, points, legs } = selection();
  const section = await createPickupRoadSectionFromSelection({
    campaignId: "campaign_pickup_adapter",
    areaId: "collection_area_adapter",
    sectionId: "collection_section_stale",
    label: "Stale route",
    points,
    legs,
  }, tasks);
  const changedTasks = [{
    ...task,
    network: { ...task.network!, coverage: [{ from: 0, to: task.network!.length, status: "completed" as const }] },
  }];
  const result = await verifyPickupRoadSectionAgainstDistribution(section, changedTasks);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "pickup_smart_marking_state_changed");
  assert.deepEqual(section.coverage, []);
});

test("Pickup adapter fails closed when points span Distribution Areas or an unprepared generation", async () => {
  const { points, legs } = selection();
  const splitPoints = points.map((point, index) => index === 2
    ? { ...point, task: { ...point.task, areaId: "distribution_area_other" } }
    : point);
  await assert.rejects(
    createPickupRoadSectionFromSelection({
      campaignId: "campaign_pickup_adapter",
      areaId: "collection_area_adapter",
      sectionId: "collection_section_bad_area",
      label: "Bad",
      points: splitPoints,
      legs,
    }, [task]),
    /pickup_smart_marking_distribution_area_mismatch/u,
  );
  await assert.rejects(
    createPickupRoadSectionFromSelection({
      campaignId: "campaign_pickup_adapter",
      areaId: "collection_area_adapter",
      sectionId: "collection_section_bad_generation",
      label: "Bad",
      points: points.map((point, index) => index === 2 ? { ...point, task: { ...point.task, areaPreparationGeneration: null } } : point),
      legs,
    }, [task]),
    /pickup_smart_marking_generation_required/u,
  );
});
