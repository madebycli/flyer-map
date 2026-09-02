import { lineString } from "@turf/helpers";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { SmartRoadCandidate } from "./smartCandidates.ts";

type Coordinate = [number, number];

export type SmartRoadPointAnchor = {
  sourceId: string;
  snapped: Coordinate;
  segmentIndex: number;
  segmentT: number;
  distanceMeters: number;
  lineDistanceMeters?: number;
};

function localSegmentParameter(point: Coordinate, start: Coordinate, end: Coordinate) {
  const latitudeRadians = (point[1] * Math.PI) / 180;
  const longitudeScale = Math.cos(latitudeRadians) * 111_320;
  const latitudeScale = 110_540;
  const startX = (start[0] - point[0]) * longitudeScale;
  const startY = (start[1] - point[1]) * latitudeScale;
  const endX = (end[0] - point[0]) * longitudeScale;
  const endY = (end[1] - point[1]) * latitudeScale;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : (-(startX * dx + startY * dy)) / lengthSquared;
  return Math.max(0, Math.min(1, rawT));
}

function finiteProperty(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closestAnchorOnRoad(
  road: SmartRoadCandidate,
  point: Coordinate,
): SmartRoadPointAnchor | null {
  const coordinates = road.geometry.coordinates;
  if (coordinates.length < 2) return null;

  try {
    const snapped = nearestPointOnLine(
      lineString(coordinates),
      point,
      { units: "meters" },
    );
    const segmentIndex = snapped.properties.segmentIndex;
    if (
      !Number.isSafeInteger(segmentIndex)
      || segmentIndex < 0
      || segmentIndex >= coordinates.length - 1
    ) {
      return null;
    }
    const start = coordinates[segmentIndex];
    const end = coordinates[segmentIndex + 1];
    const segmentT = localSegmentParameter(point, start, end);
    const snappedCoordinate: Coordinate = [
      start[0] + (end[0] - start[0]) * segmentT,
      start[1] + (end[1] - start[1]) * segmentT,
    ];
    const distanceMeters = finiteProperty(snapped.properties.pointDistance);
    if (distanceMeters === null) return null;
    const lineDistanceMeters = finiteProperty(snapped.properties.lineDistance);
    return {
      sourceId: road.sourceId,
      snapped: snappedCoordinate,
      segmentIndex,
      segmentT,
      distanceMeters,
      ...(lineDistanceMeters === null ? {} : { lineDistanceMeters }),
    };
  } catch {
    return null;
  }
}

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
