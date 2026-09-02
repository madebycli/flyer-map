import type { LngLat, PolygonGeometry } from "./campaign.ts";

const COORDINATE_EPSILON = 1e-10;
const DETERMINANT_EPSILON = 1e-15;

function finitePoint(point: LngLat) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function sameNumber(first: number, second: number) {
  return Math.abs(first - second) <= COORDINATE_EPSILON;
}

function samePoint(first: LngLat, second: LngLat) {
  return sameNumber(first[0], second[0]) && sameNumber(first[1], second[1]);
}

function ringFor(polygon: PolygonGeometry) {
  const ring = polygon.coordinates[0] ?? [];
  if (ring.length < 3) return [] as LngLat[];
  return samePoint(ring[0], ring[ring.length - 1])
    ? ring.slice(0, -1)
    : ring.slice();
}

function cross(first: LngLat, second: LngLat) {
  return first[0] * second[1] - first[1] * second[0];
}

/** Shared non-clipping predicate for server validation and pure domain tests. */
export function pointInOrOnPolygon(point: LngLat, polygon: PolygonGeometry) {
  if (!finitePoint(point)) return false;
  const ring = ringFor(polygon);
  if (ring.length < 3 || ring.some((candidate) => !finitePoint(candidate))) return false;

  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const segment = [end[0] - start[0], end[1] - start[1]] as LngLat;
    const offset = [point[0] - start[0], point[1] - start[1]] as LngLat;
    if (Math.abs(cross(segment, offset)) <= DETERMINANT_EPSILON
      && point[0] >= Math.min(start[0], end[0]) - COORDINATE_EPSILON
      && point[0] <= Math.max(start[0], end[0]) + COORDINATE_EPSILON
      && point[1] >= Math.min(start[1], end[1]) - COORDINATE_EPSILON
      && point[1] <= Math.max(start[1], end[1]) + COORDINATE_EPSILON) {
      return true;
    }
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]);
    if (crosses) {
      const intersectionLng =
        ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0];
      if (point[0] < intersectionLng) inside = !inside;
    }
  }
  return inside;
}

function signedAreaAndCentroid(ring: LngLat[]) {
  const origin = ring[0];
  let twiceArea = 0;
  let centroidLng = 0;
  let centroidLat = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = [
      ring[index][0] - origin[0],
      ring[index][1] - origin[1],
    ] as LngLat;
    const nextPoint = ring[(index + 1) % ring.length];
    const next = [
      nextPoint[0] - origin[0],
      nextPoint[1] - origin[1],
    ] as LngLat;
    const factor = cross(current, next);
    twiceArea += factor;
    centroidLng += (current[0] + next[0]) * factor;
    centroidLat += (current[1] + next[1]) * factor;
  }
  if (Math.abs(twiceArea) <= DETERMINANT_EPSILON) return null;
  return [
    origin[0] + centroidLng / (3 * twiceArea),
    origin[1] + centroidLat / (3 * twiceArea),
  ] as LngLat;
}

/**
 * Deterministic building representative point. Street clipping stays in the
 * server-only JSTS module and is intentionally not re-exported here.
 */
export function polygonRepresentativePoint(polygon: PolygonGeometry): LngLat | null {
  const ring = ringFor(polygon);
  if (ring.length < 3) return null;
  const centroid = signedAreaAndCentroid(ring);
  if (centroid && pointInOrOnPolygon(centroid, polygon)) return centroid;

  const ys = [
    centroid?.[1],
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
    ...ring.map((point, index) => {
      const next = ring[(index + 1) % ring.length];
      return (point[1] + next[1]) / 2;
    }),
  ].filter((value): value is number => Number.isFinite(value));

  for (const y of ys) {
    const intersections: number[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      if ((start[1] > y) === (end[1] > y) || sameNumber(start[1], end[1])) continue;
      intersections.push(start[0] + ((y - start[1]) * (end[0] - start[0])) / (end[1] - start[1]));
    }
    intersections.sort((first, second) => first - second);
    let best: LngLat | null = null;
    let bestWidth = -1;
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const candidate: LngLat = [(intersections[index] + intersections[index + 1]) / 2, y];
      const width = intersections[index + 1] - intersections[index];
      if (width > bestWidth && pointInOrOnPolygon(candidate, polygon)) {
        best = candidate;
        bestWidth = width;
      }
    }
    if (best) return best;
  }
  return [ring[0][0], ring[0][1]];
}
