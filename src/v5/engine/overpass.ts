import type { LngLat, RawAddressNode, RawBuilding, RawOsm, RawWay, Tags } from './types.ts';

export type Bbox = [south: number, west: number, north: number, east: number];
export type PackStats = { elements: number; ways: number; buildings: number; addresses: number; dropped: Record<string, number> };

/** One request per Area: roads (with node ids), buildings and address nodes inside the padded bbox. */
export function overpassQuery(bbox: Bbox): string {
  const b = bbox.map((n) => n.toFixed(6)).join(',');
  return `[out:json][timeout:60];(way["highway"](${b});way["building"](${b});node["addr:housenumber"](${b}););out geom qt;`;
}

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
