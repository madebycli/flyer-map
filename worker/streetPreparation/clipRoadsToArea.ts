import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon } from "@turf/helpers";
import InteriorPointArea from "jsts/org/locationtech/jts/algorithm/InteriorPointArea.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import type { LineStringGeometry, LngLat, PolygonGeometry } from "../../src/domain/campaign.ts";
import { canonicalStreetLineKey } from "./roadIdentity.ts";
import type { StreetInputGeometry } from "./types.ts";

const COORDINATE_EPSILON = 1e-12;

function finiteCoordinate(coordinate: LngLat) {
  return Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

function sameCoordinate(first: LngLat, second: LngLat) {
  return Math.abs(first[0] - second[0]) <= COORDINATE_EPSILON
    && Math.abs(first[1] - second[1]) <= COORDINATE_EPSILON;
}

function validInputGeometry(geometry: StreetInputGeometry): boolean {
  if (geometry.type === "LineString") {
    return geometry.coordinates.length >= 2
      && geometry.coordinates.every(finiteCoordinate)
      && geometry.coordinates.some((coordinate, index, coordinates) =>
        index > 0 && !sameCoordinate(coordinate, coordinates[index - 1])
      );
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.length > 0
      && geometry.coordinates.every((coordinates) =>
        validInputGeometry({ type: "LineString", coordinates })
      );
  }
  return geometry.geometries.length > 0 && geometry.geometries.every(validInputGeometry);
}

function cleanCoordinates(coordinates: LngLat[]) {
  const clean: LngLat[] = [];
  for (const coordinate of coordinates) {
    if (!finiteCoordinate(coordinate)) return null;
    if (!clean.length || !sameCoordinate(clean[clean.length - 1], coordinate)) {
      clean.push([coordinate[0], coordinate[1]]);
    }
  }
  return clean.length >= 2 ? clean : null;
}

function normalizePolygonGeometry(geometry: PolygonGeometry) {
  if (geometry.type !== "Polygon") return null;
  const rings: LngLat[][] = [];
  for (const ring of geometry.coordinates) {
    if (ring.some((coordinate) => !finiteCoordinate(coordinate))) return null;
    const clean = ring.map(([lng, lat]) => [lng, lat] as LngLat);
    if (clean.length < 3) return null;
    const closed: LngLat[] = sameCoordinate(clean[0], clean[clean.length - 1])
      ? clean
      : [...clean, [clean[0][0], clean[0][1]] as LngLat];
    if (closed.length < 4) return null;
    rings.push(closed);
  }
  return rings.length ? { type: "Polygon" as const, coordinates: rings } : null;
}

function jstsCoordinates(geometry: JstsGeometry) {
  const coordinates: LngLat[] = [];
  for (const coordinate of geometry.getCoordinates()) {
    if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) return null;
    coordinates.push([coordinate.x, coordinate.y]);
  }
  return coordinates;
}

function appendLinearParts(geometry: JstsGeometry, target: LngLat[][]) {
  if (geometry.isEmpty()) return;
  const type = geometry.getGeometryType();
  if (type === "LineString" || type === "LinearRing") {
    const coordinates = jstsCoordinates(geometry);
    if (coordinates) target.push(coordinates);
    return;
  }
  if (type !== "MultiLineString" && type !== "GeometryCollection") return;
  for (let index = 0; index < geometry.getNumGeometries(); index += 1) {
    appendLinearParts(geometry.getGeometryN(index), target);
  }
}

function normalizedAreaForTurf(geometry: PolygonGeometry) {
  const normalized = normalizePolygonGeometry(geometry);
  if (!normalized) return null;
  try {
    return polygon(normalized.coordinates);
  } catch {
    return null;
  }
}

/**
 * Boundary-aware point test backed by Turf. Invalid input is rejected.
 */
export function pointInOrOnPolygon(pointValue: LngLat, polygonGeometry: PolygonGeometry) {
  if (!finiteCoordinate(pointValue)) return false;
  const area = normalizedAreaForTurf(polygonGeometry);
  if (!area) return false;
  try {
    return booleanPointInPolygon(point(pointValue), area, { ignoreBoundary: false });
  } catch {
    return false;
  }
}

/**
 * Returns a JTS interior point instead of relying on a centroid that may be
 * outside a concave polygon or inside a hole.
 */
export function polygonRepresentativePoint(polygonGeometry: PolygonGeometry): LngLat | null {
  const normalized = normalizePolygonGeometry(polygonGeometry);
  if (!normalized) return null;
  try {
    const area = new GeoJSONReader().read(normalized);
    const coordinate = InteriorPointArea.getInteriorPoint(area);
    if (!coordinate || !Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) return null;
    const representative: LngLat = [coordinate.x, coordinate.y];
    return pointInOrOnPolygon(representative, normalized) ? representative : null;
  } catch {
    return null;
  }
}

/**
 * Validates containment with the same topology engine used for clipping.
 * This is intentionally not a midpoint or endpoint heuristic.
 */
export function lineStringInsidePolygon(
  geometry: LineStringGeometry,
  polygonGeometry: PolygonGeometry,
) {
  const normalizedArea = normalizePolygonGeometry(polygonGeometry);
  if (!normalizedArea || !validInputGeometry(geometry)) return false;
  if (geometry.coordinates.some((coordinate) => !finiteCoordinate(coordinate))) return false;
  try {
    const reader = new GeoJSONReader();
    return OverlayOp.difference(reader.read(geometry), reader.read(normalizedArea)).isEmpty();
  } catch {
    return false;
  }
}

/**
 * Clips the complete input geometry with JTS OverlayOp. The result is never
 * approximated by a bbox, endpoint, midpoint or client-side fallback.
 */
export function clipLineGeometryToPolygon(
  geometry: StreetInputGeometry,
  polygonGeometry: PolygonGeometry,
): LineStringGeometry[] {
  const normalizedArea = normalizePolygonGeometry(polygonGeometry);
  if (!normalizedArea || !validInputGeometry(geometry)) return [];
  try {
    const reader = new GeoJSONReader();
    const intersection = OverlayOp.intersection(reader.read(geometry), reader.read(normalizedArea));
    const rawFragments: LngLat[][] = [];
    appendLinearParts(intersection, rawFragments);
    const fragments: LineStringGeometry[] = [];
    const seen = new Set<string>();
    for (const raw of rawFragments) {
      const coordinates = cleanCoordinates(raw);
      if (!coordinates || coordinates.some((coordinate) => !pointInOrOnPolygon(coordinate, normalizedArea))) {
        continue;
      }
      const fragment: LineStringGeometry = { type: "LineString", coordinates };
      const key = canonicalStreetLineKey(fragment);
      if (seen.has(key)) continue;
      seen.add(key);
      fragments.push(fragment);
    }
    return fragments.sort((first, second) =>
      first.coordinates[0][0] - second.coordinates[0][0]
      || first.coordinates[0][1] - second.coordinates[0][1]
      || canonicalStreetLineKey(first).localeCompare(canonicalStreetLineKey(second))
    );
  } catch {
    return [];
  }
}

export function clipLineStringToPolygon(
  geometry: LineStringGeometry,
  polygonGeometry: PolygonGeometry,
) {
  return clipLineGeometryToPolygon(geometry, polygonGeometry);
}
