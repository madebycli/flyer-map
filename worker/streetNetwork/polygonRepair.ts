import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import type { LngLat, PolygonGeometry } from '../../src/domain/campaign.ts';
import { validateHousePolygonVertices } from '../../src/domain/geometry.ts';

const reader = new GeoJSONReader();
const writer = new GeoJSONWriter();
const BOUNDS_EPSILON = 1e-7;

function samePoint(left: LngLat, right: LngLat) {
  return left[0] === right[0] && left[1] === right[1];
}

function coordinateIsUsable(point: unknown): point is LngLat {
  return Array.isArray(point)
    && point.length === 2
    && point.every((value) => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(point[0]) <= 180
    && Math.abs(point[1]) <= 90;
}

function cleanClosedRing(input: LngLat[]) {
  if (input.length < 4 || !input.every(coordinateIsUsable)) return null;
  const open = input.slice(0, -1);
  const compact: LngLat[] = [];
  for (const point of open) {
    if (!compact.length || !samePoint(compact[compact.length - 1], point)) compact.push(point);
  }

  // OSM building ways occasionally contain an A-B-A spike. Removing the middle
  // excursion is lossless for the intended footprint and avoids dropping the house.
  let changed = true;
  while (changed && compact.length >= 3) {
    changed = false;
    for (let index = 0; index < compact.length; index += 1) {
      const previous = compact[(index - 1 + compact.length) % compact.length];
      const next = compact[(index + 1) % compact.length];
      if (!samePoint(previous, next)) continue;
      compact.splice(index, 1);
      changed = true;
      break;
    }
  }

  if (compact.length < 3) return null;
  return [...compact, compact[0]] as LngLat[];
}

function bounds(ring: LngLat[]) {
  return ring.reduce(
    (value, [lng, lat]) => ({
      minLng: Math.min(value.minLng, lng),
      minLat: Math.min(value.minLat, lat),
      maxLng: Math.max(value.maxLng, lng),
      maxLat: Math.max(value.maxLat, lat),
    }),
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
}

function outputWithinInputBounds(input: LngLat[], output: LngLat[]) {
  const before = bounds(input);
  const after = bounds(output);
  return after.minLng >= before.minLng - BOUNDS_EPSILON
    && after.minLat >= before.minLat - BOUNDS_EPSILON
    && after.maxLng <= before.maxLng + BOUNDS_EPSILON
    && after.maxLat <= before.maxLat + BOUNDS_EPSILON;
}

function acceptedPolygon(ring: LngLat[], original: LngLat[]): PolygonGeometry | null {
  if (ring.length < 4 || !samePoint(ring[0], ring[ring.length - 1])) return null;
  if (!validateHousePolygonVertices(ring.slice(0, -1)).valid) return null;
  if (!outputWithinInputBounds(original, ring)) return null;
  const polygon: PolygonGeometry = { type: 'Polygon', coordinates: [ring] };
  try {
    if (!IsValidOp.isValid(reader.read(polygon))) return null;
  } catch {
    return null;
  }
  return polygon;
}

/**
 * Normalize a closed OSM building ring without inventing a new footprint.
 *
 * Fast path keeps already-valid geometry byte-for-byte. For the small malformed
 * minority we first remove duplicate/spike vertices and then use the standard
 * JTS zero-width repair. A repair is accepted only when it is one valid polygon
 * with no holes and remains inside the source footprint bounds. Otherwise the
 * caller keeps the existing invalid_polygon rejection.
 */
export function normalizeHousePolygon(input: LngLat[]): PolygonGeometry | null {
  if (input.length < 4 || !samePoint(input[0], input[input.length - 1])) return null;
  const direct = acceptedPolygon(input, input);
  if (direct) return direct;

  const cleaned = cleanClosedRing(input);
  if (!cleaned) return null;
  const cleanedPolygon = acceptedPolygon(cleaned, input);
  if (cleanedPolygon) return cleanedPolygon;

  try {
    const source = reader.read({ type: 'Polygon', coordinates: [cleaned] });
    const repaired = BufferOp.bufferOp(source, 0);
    if (!repaired || repaired.isEmpty?.()) return null;
    const json = writer.write(repaired) as { type?: string; coordinates?: unknown };
    if (json.type !== 'Polygon' || !Array.isArray(json.coordinates) || json.coordinates.length !== 1) return null;
    const candidate = json.coordinates[0];
    if (!Array.isArray(candidate) || !candidate.every(coordinateIsUsable)) return null;
    return acceptedPolygon(candidate as LngLat[], input);
  } catch {
    return null;
  }
}
