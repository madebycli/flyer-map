import type { LineStringGeometry, LngLat, PolygonGeometry } from "./campaign.ts";

// Coordinate equality is intentionally looser than determinant/parameter math.
// Cross products are measured in degree², so reusing a 1e-10 coordinate epsilon
// for them can incorrectly classify short real-world boundary edges as parallel.
const COORDINATE_EPSILON = 1e-10;
const PARAMETER_EPSILON = 1e-12;
const DETERMINANT_EPSILON = 1e-15;

function finitePoint(point: LngLat) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function sameNumber(a: number, b: number) {
  return Math.abs(a - b) <= COORDINATE_EPSILON;
}

function samePoint(a: LngLat, b: LngLat) {
  return sameNumber(a[0], b[0]) && sameNumber(a[1], b[1]);
}

function clonePoint([lng, lat]: LngLat): LngLat {
  return [lng, lat];
}

function cross(a: LngLat, b: LngLat) {
  return a[0] * b[1] - a[1] * b[0];
}

function subtract(a: LngLat, b: LngLat): LngLat {
  return [a[0] - b[0], a[1] - b[1]];
}

function pointAt(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function parameterOnSegment(point: LngLat, start: LngLat, end: LngLat) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx === 0 ? 0 : (point[0] - start[0]) / dx;
  return dy === 0 ? 0 : (point[1] - start[1]) / dy;
}

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat) {
  if (!finitePoint(point) || !finitePoint(start) || !finitePoint(end)) return false;
  const segment = subtract(end, start);
  const offset = subtract(point, start);
  if (Math.abs(cross(segment, offset)) > DETERMINANT_EPSILON) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - COORDINATE_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + COORDINATE_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - COORDINATE_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + COORDINATE_EPSILON
  );
}

function ringFor(polygon: PolygonGeometry): LngLat[] {
  const ring = polygon.coordinates[0] ?? [];
  if (ring.length < 3) return [];
  return samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice();
}

/** True for points in the polygon or exactly on its boundary. */
export function pointInOrOnPolygon(point: LngLat, polygon: PolygonGeometry) {
  if (!finitePoint(point)) return false;
  const ring = ringFor(polygon);
  if (ring.length < 3 || ring.some((candidate) => !finitePoint(candidate))) return false;

  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]);
    if (!crosses) continue;
    const intersectionLng =
      ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0];
    if (point[0] < intersectionLng) inside = !inside;
  }
  return inside;
}

function segmentIntersectionParameters(
  lineStart: LngLat,
  lineEnd: LngLat,
  edgeStart: LngLat,
  edgeEnd: LngLat,
) {
  const direction = subtract(lineEnd, lineStart);
  const edge = subtract(edgeEnd, edgeStart);
  const delta = subtract(edgeStart, lineStart);
  const denominator = cross(direction, edge);
  const parameters: number[] = [];

  if (Math.abs(denominator) <= DETERMINANT_EPSILON) {
    if (Math.abs(cross(delta, direction)) > DETERMINANT_EPSILON) return parameters;
    for (const candidate of [edgeStart, edgeEnd]) {
      if (!pointOnSegment(candidate, lineStart, lineEnd)) continue;
      const t = parameterOnSegment(candidate, lineStart, lineEnd);
      if (t >= -PARAMETER_EPSILON && t <= 1 + PARAMETER_EPSILON) {
        parameters.push(Math.min(1, Math.max(0, t)));
      }
    }
    return parameters;
  }

  const t = cross(delta, edge) / denominator;
  const u = cross(delta, direction) / denominator;
  if (
    t >= -PARAMETER_EPSILON &&
    t <= 1 + PARAMETER_EPSILON &&
    u >= -PARAMETER_EPSILON &&
    u <= 1 + PARAMETER_EPSILON
  ) {
    parameters.push(Math.min(1, Math.max(0, t)));
  }
  return parameters;
}

function sortedUnique(values: number[]) {
  return values
    .sort((a, b) => a - b)
    .filter(
      (value, index, list) =>
        index === 0 || Math.abs(value - list[index - 1]) > PARAMETER_EPSILON,
    );
}

function segmentParameters(start: LngLat, end: LngLat, polygonRing: LngLat[]) {
  const parameters = [0, 1];
  for (let edgeIndex = 0; edgeIndex < polygonRing.length; edgeIndex += 1) {
    const edgeStart = polygonRing[edgeIndex];
    const edgeEnd = polygonRing[(edgeIndex + 1) % polygonRing.length];
    parameters.push(...segmentIntersectionParameters(start, end, edgeStart, edgeEnd));
  }
  return sortedUnique(parameters);
}

function cleanLine(points: LngLat[]) {
  const clean: LngLat[] = [];
  for (const point of points) {
    if (!clean.length || !samePoint(clean[clean.length - 1], point)) clean.push(clonePoint(point));
  }
  return clean.length >= 2 ? clean : [];
}

function segmentInsideOrOnPolygon(
  start: LngLat,
  end: LngLat,
  polygon: PolygonGeometry,
  polygonRing: LngLat[],
) {
  if (!finitePoint(start) || !finitePoint(end)) return false;
  if (!pointInOrOnPolygon(start, polygon) || !pointInOrOnPolygon(end, polygon)) return false;
  if (samePoint(start, end)) return true;

  const parameters = segmentParameters(start, end, polygonRing);
  for (let index = 0; index < parameters.length - 1; index += 1) {
    const from = parameters[index];
    const to = parameters[index + 1];
    if (to - from <= PARAMETER_EPSILON) continue;
    if (!pointInOrOnPolygon(pointAt(start, end, (from + to) / 2), polygon)) return false;
  }
  return true;
}

/**
 * Validates the complete LineString against the polygon closure. Endpoint-only
 * checks are deliberately insufficient because a concave Area can be exited
 * and re-entered between two inside vertices.
 */
export function lineStringInsidePolygon(line: LineStringGeometry, polygon: PolygonGeometry) {
  const polygonRing = ringFor(polygon);
  if (line.coordinates.length < 2 || polygonRing.length < 3) return false;
  if (polygonRing.some((point) => !finitePoint(point))) return false;

  let hasLength = false;
  for (let index = 0; index < line.coordinates.length - 1; index += 1) {
    const start = line.coordinates[index];
    const end = line.coordinates[index + 1];
    if (!finitePoint(start) || !finitePoint(end)) return false;
    if (samePoint(start, end)) continue;
    hasLength = true;
    if (!segmentInsideOrOnPolygon(start, end, polygon, polygonRing)) return false;
  }
  return hasLength;
}

/**
 * Clips a LineString exactly to a single-ring Area polygon. Each disjoint inside
 * fragment is returned separately, including boundary-aligned fragments. The
 * final containment guard is fail-closed: an unexpected numeric inconsistency
 * drops a fragment instead of allowing canonical automatic work outside Area.
 */
export function clipLineStringToPolygon(
  line: LineStringGeometry,
  polygon: PolygonGeometry,
): LineStringGeometry[] {
  const polygonRing = ringFor(polygon);
  if (
    line.coordinates.length < 2 ||
    polygonRing.length < 3 ||
    line.coordinates.some((point) => !finitePoint(point)) ||
    polygonRing.some((point) => !finitePoint(point))
  ) {
    return [];
  }

  const fragments: LineStringGeometry[] = [];
  let current: LngLat[] | null = null;

  const finishCurrent = () => {
    if (!current) return;
    const coordinates = cleanLine(current);
    if (coordinates.length >= 2) {
      const fragment: LineStringGeometry = { type: "LineString", coordinates };
      if (lineStringInsidePolygon(fragment, polygon)) fragments.push(fragment);
    }
    current = null;
  };

  for (let segmentIndex = 0; segmentIndex < line.coordinates.length - 1; segmentIndex += 1) {
    const start = line.coordinates[segmentIndex];
    const end = line.coordinates[segmentIndex + 1];
    if (samePoint(start, end)) continue;

    const parameters = segmentParameters(start, end, polygonRing);
    for (let index = 0; index < parameters.length - 1; index += 1) {
      const from = parameters[index];
      const to = parameters[index + 1];
      if (to - from <= PARAMETER_EPSILON) continue;
      const midpoint = pointAt(start, end, (from + to) / 2);
      if (!pointInOrOnPolygon(midpoint, polygon)) {
        finishCurrent();
        continue;
      }
      const intervalStart = pointAt(start, end, from);
      const intervalEnd = pointAt(start, end, to);
      if (!current) {
        current = [intervalStart, intervalEnd];
      } else if (samePoint(current[current.length - 1], intervalStart)) {
        current.push(intervalEnd);
      } else {
        finishCurrent();
        current = [intervalStart, intervalEnd];
      }
    }
  }
  finishCurrent();
  return fragments;
}

function signedAreaAndCentroid(ring: LngLat[]) {
  const origin = ring[0];
  let twiceArea = 0;
  let centroidLng = 0;
  let centroidLat = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = subtract(ring[index], origin);
    const next = subtract(ring[(index + 1) % ring.length], origin);
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
 * A deterministic representative point for a valid single-ring polygon. It
 * prefers the area centroid but safely falls back to an interior scanline point
 * (and finally a boundary vertex) for concave shapes.
 */
export function polygonRepresentativePoint(polygon: PolygonGeometry): LngLat | null {
  const ring = ringFor(polygon);
  if (ring.length < 3) return null;
  const centroid = signedAreaAndCentroid(ring);
  if (centroid && pointInOrOnPolygon(centroid, polygon)) return centroid;

  const ys = [
    centroid?.[1],
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
    ...ring.slice(0, -1).map((point, index) => (point[1] + ring[index + 1][1]) / 2),
  ].filter((value): value is number => Number.isFinite(value));
  for (const y of ys) {
    const intersections: number[] = [];
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      if ((start[1] > y) === (end[1] > y) || sameNumber(start[1], end[1])) continue;
      intersections.push(start[0] + ((y - start[1]) * (end[0] - start[0])) / (end[1] - start[1]));
    }
    intersections.sort((a, b) => a - b);
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
  return clonePoint(ring[0]);
}
