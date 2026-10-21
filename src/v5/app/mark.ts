import type { FieldHouse as House, FieldNetwork as Network, FieldSegment as Segment } from '../engine/types.ts';
import { houseKey, segmentKey, type EntityKey } from '../store/types.ts';

export type Index = {
  segments: Map<string, Segment>;
  houses: Map<string, House>;
  housesBySegment: Map<string, House[]>;
  /** Houses on a footway/path, by the street piece their address names (`streetParent`): marking that piece takes them along. */
  housesByStreetParent: Map<string, House[]>;
  /** Chunks of every junction-to-junction segment, in order. */
  chunksByGroup: Map<string, Segment[]>;
  /** Houses along each junction-to-junction street: "Nur Straßen mit Häusern" skips the ones with none. */
  groupHouses: Map<string, number>;
};

export { lassoSelect } from '../engine/lasso.ts';

export function buildIndex(network: Network): Index {
  const housesBySegment = new Map<string, House[]>();
  const housesByStreetParent = new Map<string, House[]>();
  for (const house of network.houses) {
    if (house.streetParent) {
      const linked = housesByStreetParent.get(house.streetParent);
      if (linked) linked.push(house); else housesByStreetParent.set(house.streetParent, [house]);
    }
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
  return { segments: new Map(network.segments.map((s) => [s.id, s])), houses: new Map(network.houses.map((h) => [h.id, h])), housesBySegment, housesByStreetParent, chunksByGroup, groupHouses };
}

/**
 * The whole street a search result stands for: every junction-to-junction piece with the same name that is connected to the found one (shared junction,
 * or a gap of at most `joinMeters`, such as a crossing or a roundabout). Two villages with a "Hauptstraße" stay two streets.
 * Returns the chunks of all those pieces in order of discovery.
 */
export function wholeStreet(index: Index, start: Segment, joinMeters = 60): Segment[] {
  if (!start.name) return index.chunksByGroup.get(start.group) ?? [start];
  const name = start.name;
  const groups = new Map<string, { chunks: Segment[]; ends: [number, number][]; nodes: Set<string> }>();
  // the field network keeps no full geometry: the start and the middle of every chunk are enough to see a crossing or a roundabout in between
  for (const [group, chunks] of index.chunksByGroup) {
    const first = chunks[0];
    if (first.name !== name || !first.visible) continue;
    const nodes = new Set<string>();
    for (const c of chunks) { nodes.add(c.from); nodes.add(c.to); }
    groups.set(group, { chunks, ends: chunks.flatMap((c) => [c.start, c.mid] as [number, number][]), nodes });
  }
  if (!groups.has(start.group)) return index.chunksByGroup.get(start.group) ?? [start];
  const near = (p: [number, number], q: [number, number]) => {
    const k = Math.cos((p[1] * Math.PI) / 180) * 111_320;
    return Math.hypot((p[0] - q[0]) * k, (p[1] - q[1]) * 110_540) <= joinMeters;
  };
  const taken = new Set<string>([start.group]);
  const queue = [start.group];
  while (queue.length) {
    const here = groups.get(queue.pop()!)!;
    for (const [group, other] of groups) {
      if (taken.has(group)) continue;
      let joined = false;
      for (const node of other.nodes) if (here.nodes.has(node)) { joined = true; break; }
      if (!joined) joined = here.ends.some((p) => other.ends.some((q) => near(p, q)));
      if (joined) { taken.add(group); queue.push(group); }
    }
  }
  return [...taken].flatMap((group) => groups.get(group)!.chunks);
}

/**
 * The nearest street piece that still has work: visible, with houses along it, and neither the street nor all of its houses done. `mine` limits it to
 * places the person may mark. Used by "Nächste offene Straße": after finishing a street, the next one is one tap away.
 */
export function nearestOpen(index: Index, from: [number, number], statusOf: (key: EntityKey) => string, mine: (segment: Segment) => boolean): Segment | null {
  const k = Math.cos((from[1] * Math.PI) / 180) * 111_320;
  let best: Segment | null = null, bestD = Infinity;
  const openGroups = new Map<string, boolean>();
  for (const [group, chunks] of index.chunksByGroup) {
    const first = chunks[0];
    if (!first.visible || !first.name || (index.groupHouses.get(group) ?? 0) === 0 || !mine(first)) { openGroups.set(group, false); continue; }
    const open = chunks.some((c) => statusOf(segmentKey(c.id)) === 'open') || chunks.some((c) => (index.housesBySegment.get(c.id) ?? []).some((h) => statusOf(houseKey(h.id)) === 'open'));
    openGroups.set(group, open);
  }
  for (const [group, chunks] of index.chunksByGroup) {
    if (!openGroups.get(group)) continue;
    for (const c of chunks) {
      const d = Math.hypot((c.mid[0] - from[0]) * k, (c.mid[1] - from[1]) * 110_540);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best;
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

/**
 * One street segment, optionally with all houses that belong to it. Houses on a footway/path whose address names this street come along
 * (`streetParent`), and so does such a path piece once every house on it has been taken: a path is never marked for its own sake, so paths
 * without houses, or whose houses belong to another street, stay open.
 */
export function keysForSegments(index: Index, segmentIds: Iterable<string>, withHouses: boolean, housesOnly = false): EntityKey[] {
  const keys = new Set<EntityKey>();
  const linked: House[] = [];
  for (const id of segmentIds) {
    const segment = index.segments.get(id);
    if (!segment?.visible || (housesOnly && !(index.groupHouses.get(segment.group) ?? 0))) continue;
    keys.add(segmentKey(id));
    if (withHouses) {
      for (const house of index.housesBySegment.get(id) ?? []) keys.add(houseKey(house.id));
      for (const house of index.housesByStreetParent.get(id) ?? []) { keys.add(houseKey(house.id)); linked.push(house); }
    }
  }
  const seen = new Set<string>();
  for (const house of linked) {
    const path = house.parent;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const segment = index.segments.get(path);
    if (segment?.visible && (index.housesBySegment.get(path) ?? []).every((h) => keys.has(houseKey(h.id)))) keys.add(segmentKey(path));
  }
  return [...keys];
}

/** What a finger passed over while painting: houses exactly, streets with their houses when asked. */
export function keysForTouched(index: Index, touched: { houses: Iterable<string>; segments: Iterable<string> }, withHouses: boolean, housesOnly = false): EntityKey[] {
  const keys = new Set<EntityKey>(keysForSegments(index, touched.segments, withHouses, housesOnly));
  for (const id of touched.houses) if (index.houses.has(id)) keys.add(houseKey(id));
  return [...keys];
}
