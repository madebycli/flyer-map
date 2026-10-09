import { pointInRing } from '../engine/geo.ts';
import type { LngLat } from '../engine/types.ts';

type Shape = { id: string; ring: LngLat[] };

/** Metres from a point to the vertex mean of a ring (local equirectangular): enough to rank Areas that do not contain the point. */
function distanceToCentre(point: LngLat, ring: LngLat[]): number {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const cx = open.reduce((s, p) => s + p[0], 0) / open.length, cy = open.reduce((s, p) => s + p[1], 0) / open.length;
  return Math.hypot((point[0] - cx) * 111_320 * Math.cos((point[1] * Math.PI) / 180), (point[1] - cy) * 110_574);
}

/**
 * The Area to preselect for a person standing at `point`: the one that contains it (the smaller one if they overlap), otherwise
 * the closest one within `maxMeters`, otherwise none. Used when starting to draw or edit, so the usual case is one tap fewer.
 */
export function areaAt(areas: readonly Shape[], point: LngLat, maxMeters = 1500): string | null {
  const inside = areas.filter((a) => pointInRing(point, a.ring));
  if (inside.length) return inside.map((a) => ({ id: a.id, d: distanceToCentre(point, a.ring) })).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))[0].id;
  const near = areas.map((a) => ({ id: a.id, d: distanceToCentre(point, a.ring) })).filter((a) => a.d <= maxMeters).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  return near[0]?.id ?? null;
}
