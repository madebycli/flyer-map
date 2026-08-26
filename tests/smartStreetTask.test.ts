import assert from "node:assert/strict";
import test from "node:test";
import type { SmartRoadCandidate } from "../src/domain/smartCandidates.ts";
import type { SmartRoadPointAnchor } from "../src/domain/smartRoadPointAnchor.ts";
import { createSmartStreetTaskSnapshot } from "../src/domain/smartStreetTask.ts";

function road(
  sourceId: string,
  osmId: number,
  coordinates: Array<[number, number]>,
  name = "Teststraße",
): SmartRoadCandidate {
  return {
    sourceId,
    osmId,
    name,
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates },
  };
}

function anchor(
  sourceId: string,
  segmentIndex: number,
  segmentT: number,
  snapped: [number, number],
): SmartRoadPointAnchor {
  return {
    sourceId,
    segmentIndex,
    segmentT,
    snapped,
    distanceMeters: 0,
  };
}

const baseInput = {
  campaignId: "campaign_test",
  areaId: "area_test",
  label: "Teststraße",
  taskId: "task_local-1",
  timestamp: "2026-08-26T10:00:00.000Z",
};

test("creates an application-owned Street Task id with OSM provenance kept separate", () => {
  const roads = [road("way/101", 101, [[10, 50], [10.01, 50]])];

  const task = createSmartStreetTaskSnapshot({
    ...baseInput,
    roads,
    sourceIds: ["way/101"],
    startAnchor: anchor("way/101", 0, 0, [10, 50]),
    endAnchor: anchor("way/101", 0, 1, [10.01, 50]),
  });

  assert.equal(task.id, "task_local-1");
  assert.notEqual(task.id, "way/101");
  assert.deepEqual(task.source, {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [101],
  });
  assert.equal(task.status, "open");
  assert.equal(task.completedAt, null);
});

test("clips a same-way Street snapshot exactly between the two snapped anchors", () => {
  const roads = [road("way/101", 101, [[10, 50], [10.01, 50], [10.02, 50]])];

  const task = createSmartStreetTaskSnapshot({
    ...baseInput,
    roads,
    sourceIds: ["way/101"],
    startAnchor: anchor("way/101", 0, 0.25, [10.0025, 50]),
    endAnchor: anchor("way/101", 1, 0.5, [10.015, 50]),
  });

  assert.deepEqual(task.geometry, {
    type: "LineString",
    coordinates: [
      [10.0025, 50],
      [10.01, 50],
      [10.015, 50],
    ],
  });
});

test("stitches multi-way geometry in route order and reverses source coordinates when needed", () => {
  const roads = [
    road("way/101", 101, [[10, 50], [10.01, 50]]),
    road("way/102", 102, [[10.02, 50], [10.01, 50]]),
    road("way/103", 103, [[10.02, 50], [10.03, 50]]),
  ];

  const task = createSmartStreetTaskSnapshot({
    ...baseInput,
    roads,
    sourceIds: ["way/101", "way/102", "way/103"],
    startAnchor: anchor("way/101", 0, 0.2, [10.002, 50]),
    endAnchor: anchor("way/103", 0, 0.5, [10.025, 50]),
  });

  assert.deepEqual(task.geometry.coordinates, [
    [10.002, 50],
    [10.01, 50],
    [10.02, 50],
    [10.025, 50],
  ]);
  assert.deepEqual(task.source.objectIds, [101, 102, 103]);
});

test("copies the reviewed geometry snapshot instead of retaining live OSM package coordinates", () => {
  const roads = [road("way/101", 101, [[10, 50], [10.01, 50]])];
  const task = createSmartStreetTaskSnapshot({
    ...baseInput,
    roads,
    sourceIds: ["way/101"],
    startAnchor: anchor("way/101", 0, 0, [10, 50]),
    endAnchor: anchor("way/101", 0, 1, [10.01, 50]),
  });

  roads[0].geometry.coordinates[0][0] = 99;
  assert.deepEqual(task.geometry.coordinates, [[10, 50], [10.01, 50]]);
});

test("rejects disconnected source roads instead of persisting a MultiLineString fallback", () => {
  const roads = [
    road("way/101", 101, [[10, 50], [10.01, 50]]),
    road("way/102", 102, [[11, 51], [11.01, 51]]),
  ];

  assert.throws(
    () => createSmartStreetTaskSnapshot({
      ...baseInput,
      roads,
      sourceIds: ["way/101", "way/102"],
      startAnchor: anchor("way/101", 0, 0, [10, 50]),
      endAnchor: anchor("way/102", 0, 1, [11.01, 51]),
    }),
    /continuous LineString/,
  );
});

test("rejects a forged snap that does not match the selected source segment", () => {
  const roads = [road("way/101", 101, [[10, 50], [10.01, 50]])];

  assert.throws(
    () => createSmartStreetTaskSnapshot({
      ...baseInput,
      roads,
      sourceIds: ["way/101"],
      startAnchor: anchor("way/101", 0, 0.5, [10.009, 50]),
      endAnchor: anchor("way/101", 0, 1, [10.01, 50]),
    }),
    /anchor snap/,
  );
});

test("rejects OSM identity in the domain Task id field", () => {
  const roads = [road("way/101", 101, [[10, 50], [10.01, 50]])];

  assert.throws(
    () => createSmartStreetTaskSnapshot({
      ...baseInput,
      taskId: "way/101",
      roads,
      sourceIds: ["way/101"],
      startAnchor: anchor("way/101", 0, 0, [10, 50]),
      endAnchor: anchor("way/101", 0, 1, [10.01, 50]),
    }),
    /application-owned task id/,
  );
});

test("rejects routes that revisit an OSM source section in the initial persisted format", () => {
  const roads = [
    road("way/101", 101, [[10, 50], [10.01, 50]]),
    road("way/102", 102, [[10.01, 50], [10.02, 50]]),
  ];

  assert.throws(
    () => createSmartStreetTaskSnapshot({
      ...baseInput,
      roads,
      sourceIds: ["way/101", "way/102", "way/101"],
      startAnchor: anchor("way/101", 0, 0, [10, 50]),
      endAnchor: anchor("way/101", 0, 1, [10.01, 50]),
    }),
    /does not persist routes that revisit/,
  );
});
