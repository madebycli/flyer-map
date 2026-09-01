import assert from "node:assert/strict";
import test from "node:test";
import type { DistributionTask } from "../src/domain/campaign.ts";
import { preparedSmartRoadCandidates } from "../src/domain/preparedSmartRoads.ts";
import { createSmartStreetTaskSnapshot } from "../src/domain/smartStreetTask.ts";

function task(input: Partial<DistributionTask> & Pick<DistributionTask, "id" | "geometry">): DistributionTask {
  return {
    id: input.id,
    campaignId: "campaign-1",
    areaId: input.areaId ?? "area-1",
    taskType: "street",
    label: input.label ?? "Teststraße",
    geometry: input.geometry,
    source: input.source ?? {
      dataset: "OpenStreetMap",
      objectType: "way",
      objectIds: [101],
    },
    areaPreparationGeneration: input.areaPreparationGeneration ?? "generation-1",
    status: "open",
    completedAt: null,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

test("server-prepared Street fragments become unique Smart candidates without manual tasks", () => {
  const first = task({
    id: "task_fragment_a",
    geometry: { type: "LineString", coordinates: [[13.7, 51], [13.71, 51], [13.72, 51]] },
  });
  const second = task({
    id: "task_fragment_b",
    geometry: { type: "LineString", coordinates: [[13.73, 51], [13.74, 51]] },
  });
  const manual = task({
    id: "task_manual",
    areaPreparationGeneration: null,
    geometry: { type: "LineString", coordinates: [[13.7, 51.01], [13.71, 51.01]] },
  });

  const candidates = preparedSmartRoadCandidates([first, second, manual], "area-1");
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.sourceId), [
    "prepared:task_fragment_a",
    "prepared:task_fragment_b",
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.osmId), [101, 101]);
});

test("prepared Smart candidate persists only the snapped point-to-point subsection", () => {
  const [road] = preparedSmartRoadCandidates([
    task({
      id: "task_fragment_a",
      geometry: {
        type: "LineString",
        coordinates: [[13.7, 51], [13.71, 51], [13.72, 51], [13.73, 51]],
      },
    }),
  ], "area-1");

  const result = createSmartStreetTaskSnapshot({
    campaignId: "campaign-1",
    areaId: "area-1",
    label: "Kleiner Abschnitt",
    roads: [road],
    sourceIds: [road.sourceId],
    startAnchor: {
      sourceId: road.sourceId,
      snapped: [13.705, 51],
      segmentIndex: 0,
      segmentT: 0.5,
      distanceMeters: 0,
    },
    endAnchor: {
      sourceId: road.sourceId,
      snapped: [13.715, 51],
      segmentIndex: 1,
      segmentT: 0.5,
      distanceMeters: 0,
    },
    taskId: "task_smart_section",
    timestamp: "2026-09-02T00:05:00.000Z",
  });

  assert.deepEqual(result.geometry.coordinates, [
    [13.705, 51],
    [13.71, 51],
    [13.715, 51],
  ]);
  assert.deepEqual(result.source?.objectIds, [101]);
  assert.equal(result.areaPreparationGeneration, null);
});
