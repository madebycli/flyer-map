import { pointInRing } from './geo.ts';
import type { LngLat, RawAddressNode, RawBuilding, RawOsm, RawWay, Tags } from './types.ts';

export type Bbox = [south: number, west: number, north: number, east: number];
export type PackStats = { elements: number; ways: number; buildings: number; addresses: number; dropped: Record<string, number> };

/** One request per Area: roads (with node ids), buildings and address nodes inside the padded bbox. */
export function overpassQuery(bbox: Bbox): string {
  const b = bbox.map((n) => n.toFixed(6)).join(',');
  return `[out:json][timeout:60];(way["highway"](${b});way["building"](${b});node["addr:housenumber"](${b}););out geom qt;`;
}

/** Size of the box the map data of a Gebiet is fetched for (outline plus its margin), in km². */
export function packAreaSquareKm(ring: LngLat[]): number {
  const bbox = paddedBbox(ring);
  return ((bbox[2] - bbox[0]) * 110.574) * ((bbox[3] - bbox[1]) * 111.32 * Math.cos((((bbox[0] + bbox[2]) / 2) * Math.PI) / 180));
}

/**
 * Big Gebiete are fetched, stored and derived in parts: a fixed grid over the map (the same for every Gebiet, so a part's contents never
 * depend on the outline around it). A Gebiet up to `PACK_SINGLE_MAX_SQ_KM` is one part and works exactly as before.
 */
export const PACK_CELL_LNG = 0.03;
export const PACK_CELL_LAT = 0.02;
export const PACK_SINGLE_MAX_SQ_KM = 6;
/** About 2 800 km² at 51° N: far more than any single Gebiet asks for; the limit only stops a runaway outline. */
export const MAX_PACK_PARTS = 600;
export type Cell = [west: number, south: number, east: number, north: number];
export type PackPart = { index: number; /** null for a one-part Gebiet */ cell: Cell | null; /** what is asked from the data source: the cell plus a margin */ bbox: Bbox };
export type PackPlan = { single: boolean; tooLarge: boolean; parts: PackPart[] };

const orient = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
const crossing = (a: LngLat, b: LngLat, c: LngLat, d: LngLat) => orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);

/** Does the polygon touch the cell (a corner or vertex inside, or an edge across)? */
function touches(ring: LngLat[], [w, s, e, n]: Cell): boolean {
  if (ring.some(([x, y]) => x >= w && x < e && y >= s && y < n)) return true;
  const corners: LngLat[] = [[w, s], [e, s], [e, n], [w, n]];
  if (corners.some((corner) => pointInRing(corner, ring))) return true;
  for (let i = 1; i < ring.length; i++) for (let j = 0; j < 4; j++) if (crossing(ring[i - 1], ring[i], corners[j], corners[(j + 1) % 4])) return true;
  return false;
}

export function packPlan(ring: LngLat[]): PackPlan {
  if (packAreaSquareKm(ring) <= PACK_SINGLE_MAX_SQ_KM) return { single: true, tooLarge: false, parts: [{ index: 0, cell: null, bbox: paddedBbox(ring) }] };
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const c0 = Math.floor(w / PACK_CELL_LNG), c1 = Math.floor(e / PACK_CELL_LNG), r0 = Math.floor(s / PACK_CELL_LAT), r1 = Math.floor(n / PACK_CELL_LAT);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_PACK_PARTS * 20) return { single: false, tooLarge: true, parts: [] };
  const parts: PackPart[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell: Cell = [c * PACK_CELL_LNG, r * PACK_CELL_LAT, (c + 1) * PACK_CELL_LNG, (r + 1) * PACK_CELL_LAT];
      if (!touches(ring, cell)) continue;
      parts.push({ index: parts.length, cell, bbox: paddedBbox([[cell[0], cell[1]], [cell[2], cell[3]]]) });
    }
  }
  return { single: false, tooLarge: parts.length > MAX_PACK_PARTS, parts: parts.length > MAX_PACK_PARTS ? [] : parts };
}

/** A point belongs to exactly one cell (west/south edges belong to it, east/north to the neighbour). */
export const inCell = (p: LngLat, [w, s, e, n]: Cell) => p[0] >= w && p[0] < e && p[1] >= s && p[1] < n;

export function paddedBbox(ring: LngLat[], meters = 80): Bbox {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [lng, lat] of ring) { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng); }
  const dLat = meters / 110_574, dLng = meters / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [s - dLat, w - dLng, n + dLat, e + dLng];
}

type OverpassGeometry = { lat: number; lon: number }[];
type OverpassElement = {
  type?: string; id?: number; tags?: Record<string, unknown>; nodes?: number[]; geometry?: OverpassGeometry; lat?: number; lon?: number;
};

const validPoint = (p: LngLat) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85;
const tagsOf = (raw: Record<string, unknown> | undefined): Tags => {
  const tags: Tags = {};
  for (const [key, value] of Object.entries(raw ?? {})) if (typeof value === 'string') tags[key] = value.slice(0, 200);
  return tags;
};

/** Normalise an Overpass response. Bad elements are counted, never thrown on, never silently kept. */
export function packFromOverpass(response: unknown): { raw: RawOsm; stats: PackStats } {
  const elements = (response as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error('overpass_response_invalid');
  const stats: PackStats = { elements: elements.length, ways: 0, buildings: 0, addresses: 0, dropped: {} };
  const drop = (reason: string) => { stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1; };
  const ways = new Map<number, RawWay>(), buildings = new Map<number, RawBuilding>(), addresses = new Map<number, RawAddressNode>();

  for (const element of elements) {
    if (!element || typeof element.id !== 'number') { drop('no_id'); continue; }
    const tags = tagsOf(element.tags);
    if (element.type === 'node') {
      if (!tags['addr:housenumber']) continue;
      const point: LngLat = [Number(element.lon), Number(element.lat)];
      if (!validPoint(point)) { drop('node_bad_coordinate'); continue; }
      addresses.set(element.id, { id: element.id, tags, point });
    } else if (element.type === 'way') {
      const coords = (element.geometry ?? []).map((g): LngLat => [Number(g?.lon), Number(g?.lat)]);
      if (coords.length < 2 || !coords.every(validPoint)) { drop('way_bad_geometry'); continue; }
      if (tags.highway) {
        const nodes = element.nodes && element.nodes.length === coords.length ? element.nodes : undefined;
        ways.set(element.id, { id: element.id, tags, coords, ...(nodes ? { nodes } : {}) });
      } else if (tags.building) {
        const first = coords[0], last = coords[coords.length - 1];
        if (coords.length < 4 || first[0] !== last[0] || first[1] !== last[1]) { drop('building_ring_open'); continue; }
        buildings.set(element.id, { id: element.id, tags, ring: coords });
      }
    }
  }
  stats.ways = ways.size; stats.buildings = buildings.size; stats.addresses = addresses.size;
  return { raw: { ways: [...ways.values()], buildings: [...buildings.values()], addresses: [...addresses.values()] }, stats };
}
