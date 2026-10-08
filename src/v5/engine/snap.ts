import type { LngLat, Network } from './types.ts';

export type SnapResult = { position: LngLat; address: string | null; kind: 0 | 1 | 2 };

const M_LAT = 110_574;

/**
 * The nearest house within `houseReach` metres, else the nearest visible street within `streetReach`.
 * Reference implementation over full networks (the TypeScript engine's counterpart of `Session::snap` in Rust).
 * kind: 0 nothing, 1 house, 2 street.
 */
export function snapToNetworks(networks: Network[], at: LngLat, houseReach = 30, streetReach = 22): SnapResult {
  const kx = 111_320 * Math.cos((at[1] * Math.PI) / 180);
  const d2 = (p: LngLat) => ((p[0] - at[0]) * kx) ** 2 + ((p[1] - at[1]) * M_LAT) ** 2;
  const seen = new Set<string>();
  let house: { d: number; street: string | null; number: string | null; center: LngLat } | null = null;
  for (const network of networks) for (const h of network.houses) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    if (Math.abs(h.center[0] - at[0]) * kx > houseReach || Math.abs(h.center[1] - at[1]) * M_LAT > houseReach) continue;
    const d = d2(h.center);
    if (d <= houseReach ** 2 && (!house || d < house.d)) house = { d, street: h.street, number: h.number, center: h.center };
  }
  if (house) {
    const label = [house.street, house.number].filter(Boolean).join(' ');
    return { position: house.center, address: label || null, kind: 1 };
  }
  let best: { d: number; p: LngLat; name: string | null } | null = null;
  const seenSeg = new Set<string>();
  for (const network of networks) for (const s of network.segments) {
    if (seenSeg.has(s.id)) continue;
    seenSeg.add(s.id);
    if (!s.visible) continue;
    for (let i = 0; i + 1 < s.coords.length; i++) {
      const a = s.coords[i], b = s.coords[i + 1];
      const ax = (a[0] - at[0]) * kx, ay = (a[1] - at[1]) * M_LAT, bx = (b[0] - at[0]) * kx, by = (b[1] - at[1]) * M_LAT;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy, d = px * px + py * py;
      if (d <= streetReach ** 2 && (!best || d < best.d)) best = { d, p: [at[0] + px / kx, at[1] + py / M_LAT], name: s.name };
    }
  }
  return best ? { position: best.p, address: best.name, kind: 2 } : { position: at, address: null, kind: 0 };
}
