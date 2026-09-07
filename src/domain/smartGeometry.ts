import type { Area, LngLat } from "./campaign.ts";
import type {
  OfflineMapBuildingFeature,
  OfflineMapPackage,
  OfflineMapRoadFeature,
} from "./offlineMap.ts";

const EPSILON = 1e-10;

function nearlyZero(value: number) {
  return Math.abs(value) <= EPSILON;
}

function orientation(a: LngLat, b: LngLat, c: LngLat) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function pointOnSegment(point: LngLat, start: LngLat, end: LngLat) {
  if (!nearlyZero(orientation(start, end, point))) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  );
}

export function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  ) {
    return true;
  }

  return (
    (nearlyZero(o1) && pointOnSegment(c, a, b)) ||
    (nearlyZero(o2) && pointOnSegment(d, a, b)) ||
    (nearlyZero(o3) && pointOnSegment(a, c, d)) ||
    (nearlyZero(o4) && pointOnSegment(b, c, d))
  );
}

function normalizedRing(ring: LngLat[]) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

export function pointInPolygon(point: LngLat, ringInput: LngLat[]) {
  const ring = normalizedRing(ringInput);
  if (ring.length < 3) return false;

  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (pointOnSegment(point, ring[index], ring[next])) return true;
  }

  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const crossesLatitude = currentPoint[1] > point[1] !== previousPoint[1] > point[1];
    if (!crossesLatitude) continue;
    const intersectionLng =
      ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
        (previousPoint[1] - currentPoint[1]) +
      currentPoint[0];
    if (point[0] < intersectionLng) inside = !inside;
  }
  return inside;
}

function segmentIntersectsRing(start: LngLat, end: LngLat, ringInput: LngLat[]) {
  const ring = normalizedRing(ringInput);
  if (ring.length < 2) return false;
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (segmentsIntersect(start, end, ring[index], ring[next])) return true;
  }
  return false;
}

export function lineStringIntersectsPolygon(line: LngLat[], ring: LngLat[]) {
  if (line.length < 2 || normalizedRing(ring).length < 3) return false;
  if (line.some((point) => pointInPolygon(point, ring))) return true;
  for (let index = 0; index < line.length - 1; index += 1) {
    if (segmentIntersectsRing(line[index], line[index + 1], ring)) return true;
  }
  return false;
}

export function polygonsIntersect(firstInput: LngLat[], secondInput: LngLat[]) {
  const first = normalizedRing(firstInput);
  const second = normalizedRing(secondInput);
  if (first.length < 3 || second.length < 3) return false;

  if (first.some((point) => pointInPolygon(point, second))) return true;
  if (second.some((point) => pointInPolygon(point, first))) return true;

  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length;
      if (
        segmentsIntersect(
          first[firstIndex],
          first[firstNext],
          second[secondIndex],
          second[secondNext],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function areaRing(area: Area): LngLat[] {
  return area.geometry.coordinates[0] ?? [];
}

export function roadCandidatesForArea(
  area: Area,
  pkg: OfflineMapPackage,
): OfflineMapRoadFeature[] {
  const ring = areaRing(area);
  return pkg.roads.features.filter((feature) =>
    lineStringIntersectsPolygon(feature.geometry.coordinates, ring),
  );
}

export function buildingCandidatesForArea(
  area: Area,
  pkg: OfflineMapPackage,
): OfflineMapBuildingFeature[] {
  const ring = areaRing(area);
  return pkg.buildings.features.filter((feature) =>
    polygonsIntersect(feature.geometry.coordinates[0] ?? [], ring),
  );
}
