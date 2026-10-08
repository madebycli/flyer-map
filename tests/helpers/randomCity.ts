import type { LngLat, RawOsm } from '../../src/v5/engine/index.ts';

// ── seeded fuzz ──────────────────────────────────────────────
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function randomCity(seed: number): RawOsm {
  const r = rng(seed), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)], int = (n: number) => Math.floor(r() * n);
  const lat0 = pick([51.0, 48.1, 53.5, 0.2, -33.9, 62.0]), lng0 = pick([13.0, 8.6, -122.4, 151.2]);
  const mLng = 111_320 * Math.cos((lat0 * Math.PI) / 180), mLat = 110_574;
  const P = (x: number, y: number): LngLat => [lng0 + x / mLng, lat0 + y / mLat];
  const names = ['Hauptstraße', 'Haupt-Str.', 'Hauptstrasse', 'Äußere Gasse', 'Am  Markt', 'Ring', 'Straße des 17. Juni', '', 'İstiklal Caddesi'];
  const highways = ['residential', 'residential', 'residential', 'service', 'footway', 'path', 'track', 'tertiary', 'living_street', 'cycleway', 'steps', 'motorway', 'pedestrian', 'unclassified'];
  const extra = [{}, {}, {}, { service: 'driveway' }, { service: 'alley' }, { footway: 'sidewalk' }, { surface: 'gravel' }, { access: 'private' }, { access: 'private', foot: 'yes' }, { area: 'yes' }, { ref: ' B 96 ' }];
  const ways: RawOsm['ways'] = [];
  const nodePool: { id: number; p: LngLat }[] = Array.from({ length: 40 }, (_, i) => ({ id: 9000 + i, p: P(int(900), int(900)) }));
  for (let i = 0; i < 25 + int(30); i++) {
    const useNodes = r() < 0.6;
    const n = 2 + int(5);
    const pts = Array.from({ length: n }, () => nodePool[int(nodePool.length)]);
    const coords = pts.map((q) => (r() < 0.2 ? P(int(900), int(900)) : q.p));
    const tags: Record<string, string> = { highway: pick(highways), ...(pick(extra) as Record<string, string>) };
    const name = pick(names);
    if (name || r() < 0.5) tags.name = r() < 0.2 ? ` ${name} ` : name;
    ways.push({ id: i < 3 && r() < 0.5 ? 100 : 100 + i * 7, tags, coords: r() < 0.03 ? [coords[0]] : coords, ...(useNodes ? { nodes: pts.map((q) => q.id) } : {}) });
  }
  const buildings: RawOsm['buildings'] = [];
  for (let i = 0; i < 60 + int(120); i++) {
    const x = int(900), y = int(900), w = 6 + int(14), h = 6 + int(14);
    const ring: LngLat[] = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x, y)];
    const tags: Record<string, string> = { building: pick(['house', 'yes', 'garage', 'apartments', 'barn', 'shed', 'residential', 'detached', 'cabin']) };
    if (r() < 0.55) tags['addr:housenumber'] = r() < 0.15 ? ` ${1 + int(99)}a ` : `${1 + int(99)}`;
    if (r() < 0.5) tags['addr:street'] = pick(names);
    buildings.push({ id: 5_000_000 + i * 3, tags, ring: r() < 0.03 ? ring.slice(0, 3) : ring });
  }
  const addresses: RawOsm['addresses'] = [];
  for (let i = 0; i < int(50); i++) {
    const b = buildings[int(buildings.length)];
    const near = r() < 0.7;
    // near nodes sit 6–11 m from the building's centre: straddling the 8 m snap radius and often outside the footprint
    const cx = (b.ring[0][0] + b.ring[2][0]) / 2, cy = (b.ring[0][1] + b.ring[2][1]) / 2, ang = r() * Math.PI * 2, dist = 6 + r() * 5;
    const point = near ? [cx + (Math.cos(ang) * dist) / mLng, cy + (Math.sin(ang) * dist) / mLat] as LngLat : P(int(900), int(900));
    const tags: Record<string, string> = {};
    if (r() < 0.9) tags['addr:housenumber'] = `${100 + int(50)}`;
    if (r() < 0.5) tags['addr:street'] = pick(names);
    addresses.push({ id: 7_000_000 + i, tags, point });
  }
  return { ways, buildings, addresses };
}

