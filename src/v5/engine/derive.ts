import RBush from 'rbush';
import { classifyBuilding, classifyRoad } from './classify.ts';
import { Frame, coordKey, frameFor, pointInRing, polylineLength, projectToPolyline, ringCentroid, splitEqual } from './geo.ts';
import type { House, LngLat, Network, NetworkDiagnostics, RawOsm, RawWay, Segment } from './types.ts';

export const ENGINE_VERSION = 'v5.1';

/** Streets are marked in pieces of at most this length (chunks): the unit of precise painting and partial routes. */
export const CHUNK_METERS = 60;

/** Max metres from a house centroid to the street it is assigned to. */
const MAX_PARENT_DISTANCE = 45;
const MAX_NAMED_PARENT_DISTANCE = 80;
const CLASS_PENALTY = { street: 0, access: 8, connector: 25 } as const;
/** An address node counts for a building when it lies inside it or within this many metres of the centroid. */
const ADDRESS_NODE_SNAP = 8;

const normalizeName = (name: string | null | undefined) =>
  (name ?? '').normalize('NFKC').toLocaleLowerCase('de').replace(/straße/g, 'str').replace(/strasse/g, 'str')
    .replace(/[\s.\-]+/g, '').trim();

type IndexedSegment = { minX: number; minY: number; maxX: number; maxY: number; segment: Segment; xy: [number, number][]; norm: string };

function vertexKey(way: RawWay, index: number): string {
  const node = way.nodes?.[index];
  return node !== undefined ? `n${node}` : `c${coordKey(way.coords[index])}`;
}

function bump(counter: Record<string, number>, key: string) { counter[key] = (counter[key] ?? 0) + 1; }

/**
 * Derives the delivery network from raw OSM data. Pure and deterministic: the same
 * input and ENGINE_VERSION always yield the same ids, so clients never need to sync
 * the derived entities, only the status overlay keyed by those ids.
 */
export function deriveNetwork(raw: RawOsm): Network {
  const diagnostics: NetworkDiagnostics = {
    engineVersion: ENGINE_VERSION, waysIn: raw.ways.length, waysExcluded: {}, segments: 0, visibleSegments: 0,
    promotedByHouses: 0, hiddenConnectors: 0, buildingsIn: raw.buildings.length, housesOut: 0, buildingsSkipped: {}, orphanHouses: 0,
  };
  const frame = frameFor([
    ...raw.ways.flatMap((way) => way.coords),
    ...raw.buildings.flatMap((b) => b.ring),
    ...raw.addresses.map((a) => a.point),
  ]);

  // 1. Classify and keep only candidate ways, in a stable order.
  const ways = raw.ways
    .map((way) => ({ way, verdict: classifyRoad(way.tags) }))
    .filter(({ way, verdict }) => {
      if (way.coords.length < 2) { bump(diagnostics.waysExcluded, 'degenerate'); return false; }
      if (verdict.cls === 'excluded') { bump(diagnostics.waysExcluded, verdict.reason); return false; }
      return true;
    })
    .sort((a, b) => a.way.id - b.way.id);

  // 2. Node usage: a vertex is a junction when ≥2 distinct visits touch it.
  const visits = new Map<string, number>();
  for (const { way } of ways) {
    for (let i = 0; i < way.coords.length; i++) {
      const key = vertexKey(way, i);
      visits.set(key, (visits.get(key) ?? 0) + 1);
    }
  }

  // 3. Split every way at endpoints and junctions into segments.
  const segments: Segment[] = [];
  const usedIds = new Set<string>();
  for (const { way, verdict } of ways) {
    let start = 0;
    for (let i = 1; i < way.coords.length; i++) {
      const last = i === way.coords.length - 1;
      if (!last && (visits.get(vertexKey(way, i)) ?? 0) < 2) continue;
      const coords = way.coords.slice(start, i + 1);
      // Measured in a frame of the segment's own: chunk counts (hence ids) must not depend on what else is in the pack.
      const local = frameFor(coords);
      const length = polylineLength(local, coords);
      if (length >= 0.5) {
        const startKey = way.nodes?.[start] !== undefined ? `${way.id}:${way.nodes[start]}` : `${way.id}#${start}`;
        let id = `s${startKey}`;
        if (usedIds.has(id)) id = `${id}#${start}`;
        usedIds.add(id);
        // 2 % slack: a street a hair over a multiple of 60 m must not flip to one more chunk because of rounding.
        const parts = Math.max(1, Math.ceil(length / CHUNK_METERS - 0.02));
        const pieces = splitEqual(local, coords, parts);
        const fromKey = vertexKey(way, start), toKey = vertexKey(way, i);
        pieces.forEach((piece, k) => segments.push({
          id: parts === 1 ? id : `${id}~${k}`, group: id, chunk: k, chunks: parts,
          wayId: way.id, name: way.tags.name?.trim() || null, ref: way.tags.ref?.trim() || null,
          highway: way.tags.highway, cls: verdict.cls as Segment['cls'], coords: piece, length: length / parts,
          from: k === 0 ? fromKey : `${id}@${k}`, to: k === parts - 1 ? toKey : `${id}@${k + 1}`, houseCount: 0, visible: false,
        }));
      }
      start = i;
    }
  }
  diagnostics.segments = segments.length;

  // 4. Spatial index over segments.
  const tree = new RBush<IndexedSegment>(9);
  const indexed: IndexedSegment[] = segments.map((segment) => {
    const xy = segment.coords.map((p) => frame.toXY(p));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of xy) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { minX, minY, maxX, maxY, segment, xy, norm: normalizeName(segment.name) };
  });
  tree.load(indexed);

  // 5. Houses.
  const addressNodes = [...raw.addresses].sort((a, b) => a.id - b.id);
  const nodeTree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; node: (typeof addressNodes)[number]; used: boolean }>(9);
  const nodeEntries = addressNodes.map((node) => {
    const [x, y] = frame.toXY(node.point);
    return { minX: x, minY: y, maxX: x, maxY: y, node, used: false };
  });
  nodeTree.load(nodeEntries);

  const houses: House[] = [];
  for (const building of [...raw.buildings].sort((a, b) => a.id - b.id)) {
    if (building.ring.length < 4) { bump(diagnostics.buildingsSkipped, 'degenerate_ring'); continue; }
    const center = ringCentroid(building.ring);
    const [cx, cy] = frame.toXY(center);
    let number = building.tags['addr:housenumber']?.trim() || null;
    let street = building.tags['addr:street']?.trim() || null;
    if (!number) {
      const near = nodeTree.search({ minX: cx - 40, minY: cy - 40, maxX: cx + 40, maxY: cy + 40 })
        .filter((entry) => pointInRing(entry.node.point, building.ring) || Math.hypot(entry.minX - cx, entry.minY - cy) <= ADDRESS_NODE_SNAP)
        .sort((a, b) => Math.hypot(a.minX - cx, a.minY - cy) - Math.hypot(b.minX - cx, b.minY - cy) || a.node.id - b.node.id);
      const hit = near.find((entry) => entry.node.tags['addr:housenumber']);
      if (hit) {
        hit.used = true;
        number = hit.node.tags['addr:housenumber'].trim();
        street = street ?? hit.node.tags['addr:street']?.trim() ?? null;
      }
    }
    const verdict = classifyBuilding(building.tags, number !== null);
    if (!verdict.keep) { bump(diagnostics.buildingsSkipped, verdict.reason); continue; }
    houses.push(assignParent({
      id: `h${building.id}`, osmId: building.id, source: 'building', number, street, ring: building.ring, center,
      parent: null, measure: null, evidence: verdict.evidence ?? 'address',
    }, frame, tree));
  }
  // Address nodes that belong to no building become small point-houses (rural farms, mapped-by-node).
  const buildingTree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; ring: LngLat[] }>(9);
  buildingTree.load(raw.buildings.map((b) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of b.ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { minX, minY, maxX, maxY, ring: b.ring };
  }));
  for (const entry of nodeEntries) {
    if (entry.used || !entry.node.tags['addr:housenumber']) continue;
    const [nx, ny] = entry.node.point;
    const inside = buildingTree.search({ minX: nx, minY: ny, maxX: nx, maxY: ny }).some((b) => pointInRing(entry.node.point, b.ring));
    if (inside) continue;
    const [px, py] = entry.node.point;
    const d = 0.00003;
    houses.push(assignParent({
      id: `a${entry.node.id}`, osmId: entry.node.id, source: 'address-node', number: entry.node.tags['addr:housenumber'].trim(),
      street: entry.node.tags['addr:street']?.trim() ?? null,
      ring: [[px - d, py - d], [px + d, py - d], [px + d, py + d], [px - d, py + d], [px - d, py - d]],
      center: entry.node.point, parent: null, measure: null, evidence: 'address-node',
    }, frame, tree));
  }

  // 6. Visibility: streets always; access/connector only when real houses use them.
  const bySegment = new Map(segments.map((segment) => [segment.id, segment]));
  for (const house of houses) {
    if (!house.parent) { diagnostics.orphanHouses++; continue; }
    bySegment.get(house.parent)!.houseCount++;
  }
  // Visibility is decided per junction segment: a service road that serves houses shows up with all its chunks.
  const groupHouses = new Map<string, number>();
  for (const segment of segments) groupHouses.set(segment.group, (groupHouses.get(segment.group) ?? 0) + segment.houseCount);
  for (const segment of segments) {
    segment.visible = segment.cls === 'street' || (groupHouses.get(segment.group) ?? 0) > 0;
    if (segment.visible) {
      diagnostics.visibleSegments++;
      if (segment.cls !== 'street') diagnostics.promotedByHouses++;
    } else if (segment.cls === 'connector') diagnostics.hiddenConnectors++;
  }
  diagnostics.housesOut = houses.length;
  houses.sort((a, b) => a.id.localeCompare(b.id));
  return { segments, houses, diagnostics };
}

function assignParent(house: House, frame: Frame, tree: RBush<IndexedSegment>): House {
  const [cx, cy] = frame.toXY(house.center);
  const reach = MAX_NAMED_PARENT_DISTANCE;
  const wanted = normalizeName(house.street);
  let best: { score: number; segment: Segment; measure: number } | null = null;
  for (const entry of tree.search({ minX: cx - reach, minY: cy - reach, maxX: cx + reach, maxY: cy + reach })) {
    const projection = projectToPolyline(entry.xy, [cx, cy]);
    const named = wanted !== '' && entry.norm === wanted;
    const limit = named ? MAX_NAMED_PARENT_DISTANCE : MAX_PARENT_DISTANCE;
    if (projection.distance > limit) continue;
    // A name match outweighs a nearer wrong street; class penalty keeps paths from stealing houses.
    const score = projection.distance + CLASS_PENALTY[entry.segment.cls] - (named ? 30 : 0);
    if (!best || score < best.score || (score === best.score && entry.segment.id < best.segment.id)) {
      best = { score, segment: entry.segment, measure: projection.measure };
    }
  }
  return best ? { ...house, parent: best.segment.id, measure: Math.round(best.measure * 10) / 10 } : house;
}
