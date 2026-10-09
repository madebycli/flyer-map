import type { FieldHouse as House, FieldNetwork as Network, FieldSegment as Segment } from '../engine/types.ts';
import { houseKey, segmentKey, type EntityKey } from '../store/types.ts';

export type Index = {
  segments: Map<string, Segment>;
  houses: Map<string, House>;
  housesBySegment: Map<string, House[]>;
  /** Chunks of every junction-to-junction segment, in order. */
  chunksByGroup: Map<string, Segment[]>;
  /** Houses along each junction-to-junction street: "Nur Straßen mit Häusern" skips the ones with none. */
  groupHouses: Map<string, number>;
};

export { lassoSelect } from '../engine/lasso.ts';

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
  const groupHouses = new Map<string, number>();
  for (const segment of network.segments) groupHouses.set(segment.group, (groupHouses.get(segment.group) ?? 0) + segment.houseCount);
  return { segments: new Map(network.segments.map((s) => [s.id, s])), houses: new Map(network.houses.map((h) => [h.id, h])), housesBySegment, chunksByGroup, groupHouses };
}

/** Everything of a street piece in one go: all chunks of the tapped junction segment (and optionally their houses). */
export function keysForGroups(index: Index, segmentIds: Iterable<string>, withHouses: boolean, housesOnly = false): EntityKey[] {
  const ids = new Set<string>();
  for (const id of segmentIds) {
    const segment = index.segments.get(id);
    for (const chunk of segment ? index.chunksByGroup.get(segment.group) ?? [segment] : []) ids.add(chunk.id);
  }
  return keysForSegments(index, ids, withHouses, housesOnly);
}

/** One street segment, optionally with all houses that belong to it. */
export function keysForSegments(index: Index, segmentIds: Iterable<string>, withHouses: boolean, housesOnly = false): EntityKey[] {
  const keys = new Set<EntityKey>();
  for (const id of segmentIds) {
    const segment = index.segments.get(id);
    if (!segment?.visible || (housesOnly && !(index.groupHouses.get(segment.group) ?? 0))) continue;
    keys.add(segmentKey(id));
    if (withHouses) for (const house of index.housesBySegment.get(id) ?? []) keys.add(houseKey(house.id));
  }
  return [...keys];
}

/** What a finger passed over while painting: houses exactly, streets with their houses when asked. */
export function keysForTouched(index: Index, touched: { houses: Iterable<string>; segments: Iterable<string> }, withHouses: boolean, housesOnly = false): EntityKey[] {
  const keys = new Set<EntityKey>(keysForSegments(index, touched.segments, withHouses, housesOnly));
  for (const id of touched.houses) if (index.houses.has(id)) keys.add(houseKey(id));
  return [...keys];
}
