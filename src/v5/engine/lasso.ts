import { pointInRing } from './geo.ts';
import type { FieldNetwork, LngLat } from './types.ts';

/**
 * Lasso: houses whose centre lies inside the shape, and visible street pieces whose middle does; with `housesOnly`, streets without
 * a house are skipped. Purely geometric. TypeScript reference of `session_lasso` in the Rust engine (compared differentially).
 */
export function lassoSelect(network: Pick<FieldNetwork, 'segments' | 'houses'>, ring: LngLat[], housesOnly = false): { houses: string[]; segments: string[] } {
  if (ring.length < 3) return { houses: [], segments: [] };
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of ring) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; }
  const inside = (p: LngLat) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n && pointInRing(p, ring);
  const groupHouses = new Map<string, number>();
  if (housesOnly) for (const seg of network.segments) groupHouses.set(seg.group, (groupHouses.get(seg.group) ?? 0) + seg.houseCount);
  return {
    houses: network.houses.filter((h) => inside(h.center)).map((h) => h.id),
    segments: network.segments.filter((seg) => seg.visible && (!housesOnly || (groupHouses.get(seg.group) ?? 0) > 0) && inside(seg.mid)).map((seg) => seg.id),
  };
}
