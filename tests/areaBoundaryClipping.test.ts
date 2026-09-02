import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LineStringGeometry, LngLat, PolygonGeometry } from "../src/domain/campaign.ts";
import {
  clipLineStringToPolygon,
  lineStringInsidePolygon,
  pointInOrOnPolygon,
} from "../worker/streetPreparation/clipRoadsToArea.ts";

function polygon(points: LngLat[], closed = true): PolygonGeometry {
  const ring = points.map(([lng, lat]) => [lng, lat] as LngLat);
  if (closed && ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function line(points: LngLat[]): LineStringGeometry {
  return { type: "LineString", coordinates: points };
}

function assertLineInsidePolygon(candidate: LineStringGeometry, area: PolygonGeometry) {
  assert.equal(
    lineStringInsidePolygon(candidate, area),
    true,
    `expected contained LineString: ${JSON.stringify(candidate.coordinates)}`,
  );
  for (const point of candidate.coordinates) {
    assert.equal(pointInOrOnPolygon(point, area), true, `outside vertex: ${JSON.stringify(point)}`);
  }
}

function assertAllInside(fragments: LineStringGeometry[], area: PolygonGeometry) {
  for (const fragment of fragments) assertLineInsidePolygon(fragment, area);
}

const square = polygon([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

const concave = polygon([
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 10],
  [6, 4],
  [4, 4],
  [4, 10],
  [0, 10],
]);

test("automatic Street clipping matrix keeps every complete segment inside Area", () => {
  const cases: Array<{ name: string; area: PolygonGeometry; road: LineStringGeometry; expected: LineStringGeometry[] }> = [
    { name: "fully inside convex Area", area: square, road: line([[1, 1], [9, 1]]), expected: [line([[1, 1], [9, 1]])] },
    { name: "fully outside", area: square, road: line([[-2, 5], [-1, 5]]), expected: [] },
    { name: "outside to inside to outside", area: square, road: line([[-2, 5], [12, 5]]), expected: [line([[0, 5], [10, 5]])] },
    { name: "inside to outside", area: square, road: line([[5, 5], [12, 5]]), expected: [line([[5, 5], [10, 5]])] },
    { name: "outside to inside", area: square, road: line([[-2, 5], [5, 5]]), expected: [line([[0, 5], [5, 5]])] },
    { name: "road exactly on boundary", area: square, road: line([[-2, 0], [12, 0]]), expected: [line([[0, 0], [10, 0]])] },
    { name: "single point tangent", area: square, road: line([[-2, -2], [0, 0], [-2, 2]]), expected: [] },
    { name: "polygon corner tangent", area: square, road: line([[-1, 1], [0, 0], [1, -1]]), expected: [] },
    { name: "concave exit and re-entry", area: concave, road: line([[-1, 7], [11, 7]]), expected: [line([[0, 7], [4, 7]]), line([[6, 7], [10, 7]])] },
    { name: "inside endpoints still cross outside through concavity", area: concave, road: line([[1, 7], [9, 7]]), expected: [line([[1, 7], [4, 7]]), line([[6, 7], [9, 7]])] },
    { name: "multi segment LineString with several crossings", area: concave, road: line([[-1, 2], [5, 2], [5, 8], [11, 8]]), expected: [line([[0, 2], [5, 2], [5, 4]]), line([[6, 8], [10, 8]])] },
    { name: "duplicate road vertices", area: square, road: line([[-1, 5], [5, 5], [5, 5], [11, 5]]), expected: [line([[0, 5], [5, 5], [10, 5]])] },
    { name: "nearly boundary collinear", area: square, road: line([[-1, 1e-9], [11, 1e-9]]), expected: [line([[0, 1e-9], [10, 1e-9]])] },
  ];

  for (const fixture of cases) {
    const fragments = clipLineStringToPolygon(fixture.road, fixture.area);
    assert.deepEqual(fragments, fixture.expected, fixture.name);
    assertAllInside(fragments, fixture.area);
  }
});

test("real geographic crossing is clipped to exact Area boundary", () => {
  const area = polygon([[13.700, 51.000], [13.710, 51.000], [13.710, 51.010], [13.700, 51.010]]);
  const fragments = clipLineStringToPolygon(line([[13.699, 51.005], [13.711, 51.005]]), area);
  assert.deepEqual(fragments, [line([[13.700, 51.005], [13.710, 51.005]])]);
  assertAllInside(fragments, area);
});

test("ring orientation and explicit closure do not change clipping", () => {
  const unclosed = polygon([[0, 0], [10, 0], [10, 10], [0, 10]], false);
  const reversed: PolygonGeometry = { type: "Polygon", coordinates: [square.coordinates[0].slice().reverse()] };
  const road = line([[-1, 5], [11, 5]]);
  const expected = [line([[0, 5], [10, 5]])];
  assert.deepEqual(clipLineStringToPolygon(road, unclosed), expected);
  assert.deepEqual(clipLineStringToPolygon(road, reversed), expected);
  assertAllInside(expected, unclosed);
  assertAllInside(expected, reversed);
});

test("short real-world boundary edge cannot make a long outside tail fail open", () => {
  const narrowTipArea = polygon([
    [13.700, 51.000], [13.709, 51.000], [13.709, 51.004],
    [13.710, 51.004999995], [13.710, 51.005000005],
    [13.709, 51.006], [13.709, 51.010], [13.700, 51.010],
  ]);
  const fragments = clipLineStringToPolygon(line([[13.708, 51.005], [13.711, 51.005]]), narrowTipArea);
  assert.deepEqual(fragments, [line([[13.708, 51.005], [13.710, 51.005]])]);
  assertAllInside(fragments, narrowTipArea);
  assert.equal(fragments.flatMap((fragment) => fragment.coordinates).some(([lng]) => lng > 13.7100000001), false);
});

test("invalid and zero-length inputs never create automatic Street fragments", () => {
  assert.deepEqual(clipLineStringToPolygon(line([[1, 1], [1, 1]]), square), []);
  assert.deepEqual(clipLineStringToPolygon(line([[Number.NaN, 1], [2, 1]]), square), []);
  assert.deepEqual(clipLineStringToPolygon(line([[Number.POSITIVE_INFINITY, 1], [2, 1]]), square), []);
});

test("MapLibre Street source consumes canonical task geometry", () => {
  const source = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
  assert.match(source, /function streetsToGeoJson[\s\S]*coordinates:\s*task\.geometry\.coordinates/u);
});
