import { pointInRing } from '../engine/geo.ts';
import type { FieldHouse as House, FieldNetwork as Network, FieldSegment as Segment, LngLat } from '../engine/types.ts';
import { houseKey, segmentKey, type EntityKey } from '../store/types.ts';

export type Index = {
  segments: Map<string, Segment>;
  houses: Map<string, House>;
  housesBySegment: Map<string, House[]>;
  /** Chunks of every junction-to-junction segment, in order. */
  chunksByGroup: Map<string, Segment[]>;
};

export function buildIndex(network: Network): Index {
  const housesBySegment = new Map<string, House[]>();
  for (const house of network.houses) {
    if (!house.parent) continue;
    const list = housesBySegment.get(house.parent);
    if (list) list.push(house); else housesBySegment.set(house.parent, [house]);
  }
  const chunksByGroup = new Map<string, Segment[]>();
  for (const segment of network.segments) {
    const list = chunksByGroup.get(segment.group);
    if (list) list.push(segment); else chunksByGroup.set(segment.group, [segment]);
  }
  for (const list of chunksByGroup.values()) list.sort((a, b) => a.chunk - b.chunk);
  return { segments: new Map(network.segments.map((s) => [s.id, s])), houses: new Map(network.houses.map((h) => [h.id, h])), housesBySegment, chunksByGroup };
}

/** Everything of a street piece in one go: all chunks of the tapped junction segment (and optionally their houses). */
export function keysForGroups(index: Index, segmentIds: Iterable<string>, withHouses: boolean): EntityKey[] {
  const ids = new Set<string>();
  for (const id of segmentIds) {
    const segment = index.segments.get(id);
    for (const chunk of segment ? index.chunksByGroup.get(segment.group) ?? [segment] : []) ids.add(chunk.id);
  }
  return keysForSegments(index, ids, withHouses);
}

/** One street segment, optionally with all houses that belong to it. */
export function keysForSegments(index: Index, segmentIds: Iterable<string>, withHouses: boolean): EntityKey[] {
  const keys = new Set<EntityKey>();
  for (const id of segmentIds) {
    const segment = index.segments.get(id);
    if (!segment?.visible) continue;
    keys.add(segmentKey(id));
    if (withHouses) for (const house of index.housesBySegment.get(id) ?? []) keys.add(houseKey(house.id));
  }
  return [...keys];
}

/** What a finger passed over while painting: houses exactly, streets with their houses when asked. */
export function keysForTouched(index: Index, touched: { houses: Iterable<string>; segments: Iterable<string> }, withHouses: boolean): EntityKey[] {
  const keys = new Set<EntityKey>(keysForSegments(index, touched.segments, withHouses));
  for (const id of touched.houses) if (index.houses.has(id)) keys.add(houseKey(id));
  return [...keys];
}

const middle = (s: Segment): LngLat => s.mid;

/** Lasso: houses whose centre lies inside the shape, and visible street segments whose middle does. Purely geometric. */
export function lassoSelect(network: Network, ring: LngLat[]): { houses: string[]; segments: string[] } {
  if (ring.length < 3) return { houses: [], segments: [] };
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of ring) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; }
  const inside = (p: LngLat) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n && pointInRing(p, ring);
  return {
    houses: network.houses.filter((h) => inside(h.center)).map((h) => h.id),
    segments: network.segments.filter((seg) => seg.visible && inside(middle(seg))).map((seg) => seg.id),
  };
}
