import assert from "node:assert/strict";
import test from "node:test";
import type { SmartRoadCandidate } from "../src/domain/smartCandidates.ts";
import {
  selectSmartRoadRange,
  smartRoadSelectionLabel,
} from "../src/domain/smartRoadSelection.ts";

function road(
  sourceId: string,
  name: string | null,
  coordinates: [number, number][],
): SmartRoadCandidate {
  return {
    sourceId,
    osmId: Number(sourceId.replace(/\D+/gu, "")) || 1,
    name,
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates },
  };
}

const chain = [
  road("way/1", "Hauptstraße", [[13.4, 52.5], [13.41, 52.5]]),
  road("way/2", "Hauptstraße", [[13.41, 52.5], [13.42, 52.5]]),
  road("way/3", "Andere Straße", [[13.42, 52.5], [13.43, 52.5]]),
];

test("same start/end source selects one detailed road segment", () => {
  assert.deepEqual(selectSmartRoadRange(chain, "way/2", "way/2"), {
    state: "selected",
    sourceIds: ["way/2"],
  });
});

test("start and end anchors select connected source sections regardless of road name", () => {
  assert.deepEqual(selectSmartRoadRange(chain, "way/1", "way/3"), {
    state: "selected",
    sourceIds: ["way/1", "way/2", "way/3"],
  });
});

test("disconnected anchors do not fabricate a route", () => {
  const roads = [
    ...chain,
    road("way/9", "Hauptstraße", [[13.9, 52.5], [13.91, 52.5]]),
  ];
  assert.deepEqual(selectSmartRoadRange(roads, "way/1", "way/9"), {
    state: "disconnected",
    sourceIds: [],
  });
});

test("multiple topological routes are surfaced as ambiguous", () => {
  const roads = [
    road("way/1", "A", [[13.4, 52.5], [13.41, 52.5]]),
    road("way/2", "B", [[13.41, 52.5], [13.42, 52.51]]),
    road("way/3", "C", [[13.42, 52.51], [13.43, 52.5]]),
    road("way/4", "D", [[13.41, 52.5], [13.42, 52.49]]),
    road("way/5", "E", [[13.42, 52.49], [13.43, 52.5]]),
    road("way/6", "F", [[13.43, 52.5], [13.44, 52.5]]),
  ];

  assert.deepEqual(selectSmartRoadRange(roads, "way/1", "way/6"), {
    state: "ambiguous",
    sourceIds: [],
  });
});

test("selection label reports the exact selected section count", () => {
  assert.equal(smartRoadSelectionLabel(chain, ["way/1", "way/2", "way/3"]), "3 Straßenabschnitte");
});
