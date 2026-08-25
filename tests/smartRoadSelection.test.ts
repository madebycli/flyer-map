import assert from "node:assert/strict";
import test from "node:test";
import type { SmartRoadCandidate } from "../src/domain/smartCandidates.ts";
import {
  selectSmartRoadSourceIds,
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

const roads = [
  road("way/1", "Hauptstraße", [[13.4, 52.5], [13.41, 52.5]]),
  road("way/2", "Hauptstraße", [[13.41, 52.5], [13.42, 52.5]]),
  road("way/3", "Hauptstraße", [[13.5, 52.5], [13.51, 52.5]]),
  road("way/4", "Nebenstraße", [[13.42, 52.5], [13.43, 52.5]]),
  road("way/5", null, [[13.6, 52.5], [13.61, 52.5]]),
];

test("source-segment mode selects only the clicked OSM way", () => {
  assert.deepEqual(selectSmartRoadSourceIds(roads, "way/1", "source-segment"), ["way/1"]);
});

test("connected-same-name mode grows only through touching segments with the same name", () => {
  assert.deepEqual(selectSmartRoadSourceIds(roads, "way/1", "connected-same-name"), [
    "way/1",
    "way/2",
  ]);
});

test("same named but disconnected road pieces are not silently grouped", () => {
  assert.deepEqual(selectSmartRoadSourceIds(roads, "way/3", "connected-same-name"), ["way/3"]);
});

test("unnamed roads stay single-source even in connected mode", () => {
  assert.deepEqual(selectSmartRoadSourceIds(roads, "way/5", "connected-same-name"), ["way/5"]);
});

test("unknown source ids select nothing", () => {
  assert.deepEqual(selectSmartRoadSourceIds(roads, "way/missing", "connected-same-name"), []);
});

test("selection label uses the shared street name for grouped segments", () => {
  assert.equal(smartRoadSelectionLabel(roads, ["way/1", "way/2"]), "Hauptstraße");
});
