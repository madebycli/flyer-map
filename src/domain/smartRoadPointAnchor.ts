import type { SmartRoadCandidate } from "./smartCandidates.ts";

type Coordinate = [number, number];

export type SmartRoadPointAnchor = {
  sourceId: string;
  snapped: Coordinate;
  segmentIndex: number;
  segmentT: number;
  distanceMeters: number;
};

const METERS_PER_DEGREE_LAT = 110_540;
const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111_320;

function localMeters(
  origin: Coordinate,
  point: Coordinate,
): [number, number] {
  const latitudeRadians = (origin[1] * Math.PI) / 180;
  return [
    (point[0] - origin[0]) * Math.cos(latitudeRadians) * METERS_PER_DEGREE_LNG_AT_EQUATOR,
    (point[1] - origin[1]) * METERS_PER_DEGREE_LAT,
  ];
}

function closestPointOnSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
) {
  const [startX, startY] = localMeters(point, start);
  const [endX, endY] = localMeters(point, end);
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : (-(startX * dx + startY * dy)) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projectedX = startX + dx * t;
  const projectedY = startY + dy * t;
  const distanceMeters = Math.hypot(projectedX, projectedY);

  return {
    t,
    snapped: [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ] as Coordinate,
    distanceMeters,
  };
}

function closestAnchorOnRoad(
  road: SmartRoadCandidate,
  point: Coordinate,
): SmartRoadPointAnchor | null {
  const coordinates = road.geometry.coordinates;
  if (coordinates.length < 2) return null;

  let best: SmartRoadPointAnchor | null = null;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const candidate = closestPointOnSegment(point, coordinates[index], coordinates[index + 1]);
    if (!best || candidate.distanceMeters < best.distanceMeters) {
      best = {
        sourceId: road.sourceId,
        snapped: candidate.snapped,
        segmentIndex: index,
        segmentT: candidate.t,
        distanceMeters: candidate.distanceMeters,
      };
    }
  }
  return best;
}

/**
 * Return nearby road hit candidates for one map click/tap.
 *
 * The caller intentionally receives multiple candidates near intersections. It
 * can highlight them for user choice instead of treating the nearest source id as
 * authority. This helper does not create Tasks or mutate Campaign state.
 */
export function smartRoadPointAnchorCandidates(
  roads: SmartRoadCandidate[],
  point: Coordinate,
  maxDistanceMeters = 25,
  limit = 4,
): SmartRoadPointAnchor[] {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0 || maxDistanceMeters > 100) {
    return [];
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) return [];

  return roads
    .map((road) => closestAnchorOnRoad(road, point))
    .filter((anchor): anchor is SmartRoadPointAnchor => (
      anchor !== null && anchor.distanceMeters <= maxDistanceMeters
    ))
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.sourceId.localeCompare(b.sourceId))
    .slice(0, limit);
}
