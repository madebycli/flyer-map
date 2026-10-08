import { pointInRing } from './geo.ts';
import type { LngLat, Network, NetworkDiagnostics } from './types.ts';

/**
 * Keep what belongs to an Area polygon: houses whose centre lies inside, and street
 * segments that touch it (a vertex inside, or serving a kept house). Visibility and
 * house counts are recomputed, so a connector only appears for houses inside the Area.
 */
export function restrictToArea(network: Network, ring: LngLat[]): Network {
  const houses = network.houses.filter((h) => pointInRing(h.center, ring));
  const counts = new Map<string, number>();
  for (const h of houses) if (h.parent) counts.set(h.parent, (counts.get(h.parent) ?? 0) + 1);
  const kept = network.segments.filter((s) => counts.has(s.id) || s.coords.some((p) => pointInRing(p, ring)) || crossesRing(s.coords, ring));
  const groupHouses = new Map<string, number>();
  for (const s of kept) groupHouses.set(s.group, (groupHouses.get(s.group) ?? 0) + (counts.get(s.id) ?? 0));
  const segments = kept.map((s) => ({ ...s, houseCount: counts.get(s.id) ?? 0, visible: s.cls === 'street' || (groupHouses.get(s.group) ?? 0) > 0 }));
  return {
    segments, houses,
    diagnostics: { ...network.diagnostics, segments: segments.length, visibleSegments: segments.filter((s) => s.visible).length, housesOut: houses.length },
  };
}

function crossesRing(line: LngLat[], ring: LngLat[]): boolean {
  for (let i = 1; i < line.length; i++) {
    for (let j = 1; j < ring.length; j++) if (intersects(line[i - 1], line[i], ring[j - 1], ring[j])) return true;
  }
  return false;
}

function intersects(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * Combine per-Area networks. Overlapping Areas share OSM ids, so a house or segment
 * seen twice keeps one entry (first Area wins) and therefore one status.
 */
export function mergeNetworks<S extends { id: string; visible: boolean }, H extends { id: string }>(
  parts: { areaId: string; network: { segments: S[]; houses: H[]; diagnostics: NetworkDiagnostics } }[],
): { network: { segments: S[]; houses: H[]; diagnostics: NetworkDiagnostics }; areaOf: Map<string, string> } {
  const segments = new Map<string, S>();
  const houses = new Map<string, H>();
  const areaOf = new Map<string, string>();
  for (const { areaId, network } of parts) {
    for (const s of network.segments) if (!segments.has(s.id)) { segments.set(s.id, s); areaOf.set(`s:${s.id}`, areaId); }
    for (const h of network.houses) if (!houses.has(h.id)) { houses.set(h.id, h); areaOf.set(`h:${h.id}`, areaId); }
  }
  const first = parts[0]?.network.diagnostics;
  const list = [...segments.values()];
  return {
    network: {
      segments: list, houses: [...houses.values()],
      diagnostics: { ...(first ?? { engineVersion: '', waysIn: 0, waysExcluded: {}, promotedByHouses: 0, hiddenConnectors: 0, buildingsIn: 0, buildingsSkipped: {}, orphanHouses: 0, segments: 0, visibleSegments: 0, housesOut: 0 }),
        segments: list.length, visibleSegments: list.filter((s) => s.visible).length, housesOut: houses.size },
    },
    areaOf,
  };
}
