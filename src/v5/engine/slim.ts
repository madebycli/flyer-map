import type { FieldNetwork, LngLat, Network } from './types.ts';

/** Midpoint along a polyline, measured in degrees: it only has to be stable and central (same rule in Rust). */
export function midpointByLength(coords: LngLat[]): LngLat | null {
  if (coords.length < 2) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) { const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]); lengths.push(d); total += d; }
  let rest = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : rest / lengths[i];
      return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
    }
    rest -= lengths[i];
  }
  return null;
}

const r7 = (v: number) => Math.floor(v * 1e7 + 0.5) / 1e7;

/** The coordinate-free view of a full network (the TypeScript engine's counterpart of the Rust `slim`). */
export function slimNetwork(network: Network): FieldNetwork {
  return {
    segments: network.segments.map(({ coords, ...rest }) => {
      const m = midpointByLength(coords) ?? coords[0];
      return { ...rest, mid: [r7(m[0]), r7(m[1])] as LngLat, start: coords[0] };
    }),
    houses: network.houses.map(({ ring: _ring, ...rest }) => rest),
    diagnostics: network.diagnostics,
  };
}
