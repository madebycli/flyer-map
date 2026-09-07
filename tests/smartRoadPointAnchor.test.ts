import assert from "node:assert/strict";
import test from "node:test";
import type { SmartRoadCandidate } from "../src/domain/smartCandidates.ts";
import { smartRoadPointAnchorCandidates } from "../src/domain/smartRoadPointAnchor.ts";

function road(sourceId: string, coordinates: [number, number][]): SmartRoadCandidate {
  return {
    sourceId,
    osmId: Number(sourceId.replace(/\D+/gu, "")) || 1,
    name: sourceId,
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates },
  };
}

test("a map click snaps to the nearest point inside one road segment", () => {
  const candidates = smartRoadPointAnchorCandidates(
    [road("way/1", [[8, 49], [8.01, 49]])],
    [8.005, 49.0001],
    20,
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, "way/1");
  assert.ok(Math.abs(candidates[0].snapped[0] - 8.005) < 0.000001);
  assert.ok(Math.abs(candidates[0].snapped[1] - 49) < 0.000001);
  assert.ok(Math.abs(candidates[0].segmentT - 0.5) < 0.001);
  assert.ok(candidates[0].distanceMeters > 10 && candidates[0].distanceMeters < 12);
});

test("a click near an intersection can return multiple road choices instead of guessing", () => {
  const candidates = smartRoadPointAnchorCandidates(
    [
      road("way/1", [[8, 49], [8.01, 49]]),
      road("way/2", [[8.005, 48.995], [8.005, 49.005]]),
    ],
    [8.005, 49],
    5,
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.sourceId)), new Set(["way/1", "way/2"]));
  assert.ok(candidates.every((candidate) => candidate.distanceMeters < 0.01));
});

test("far roads are not offered as click candidates", () => {
  assert.deepEqual(
    smartRoadPointAnchorCandidates(
      [road("way/1", [[8, 49], [8.01, 49]])],
      [8.005, 49.01],
      25,
    ),
    [],
  );
});

test("snap distance and candidate count are bounded", () => {
  const roads = Array.from({ length: 10 }, (_, index) =>
    road(`way/${index + 1}`, [[8, 49 + index * 0.000001], [8.01, 49 + index * 0.000001]]),
  );

  assert.equal(smartRoadPointAnchorCandidates(roads, [8.005, 49], 25, 3).length, 3);
  assert.deepEqual(smartRoadPointAnchorCandidates(roads, [8.005, 49], 0, 3), []);
  assert.deepEqual(smartRoadPointAnchorCandidates(roads, [8.005, 49], 101, 3), []);
  assert.deepEqual(smartRoadPointAnchorCandidates(roads, [8.005, 49], 25, 9), []);
});
