import type { LngLat } from './types.ts';

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQ = 111_320;

/** Local equirectangular frame: accurate to centimetres over a few km, no dependencies. */
export class Frame {
  readonly cosLat: number;
  constructor(readonly lng0: number, readonly lat0: number) {
    this.cosLat = Math.cos((lat0 * Math.PI) / 180);
  }
  x(lng: number) { return (lng - this.lng0) * this.cosLat * M_PER_DEG_LNG_EQ; }
  y(lat: number) { return (lat - this.lat0) * M_PER_DEG_LAT; }
  toXY(p: LngLat): [number, number] { return [this.x(p[0]), this.y(p[1])]; }
}

export function frameFor(points: Iterable<LngLat>): Frame {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return new Frame(0, 0);
  return new Frame((minX + maxX) / 2, (minY + maxY) / 2);
}

export function polylineLength(frame: Frame, coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += Math.hypot(frame.x(coords[i][0]) - frame.x(coords[i - 1][0]), frame.y(coords[i][1]) - frame.y(coords[i - 1][1]));
  }
  return total;
}

export type Projection = { distance: number; measure: number };

/** Nearest point of a polyline (already in metres) to `p`: distance and distance along the line. */
export function projectToPolyline(line: [number, number][], p: [number, number]): Projection {
  let best = Infinity, bestMeasure = 0, walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
    const segLen = Math.sqrt(len2);
    if (d < best) { best = d; bestMeasure = walked + t * segLen; }
    walked += segLen;
  }
  return { distance: best, measure: bestMeasure };
}

export function ringCentroid(ring: LngLat[]): LngLat {
  // Area-weighted centroid; falls back to the vertex mean for degenerate rings.
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-18) {
    const n = Math.max(1, ring.length - 1);
    return [ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n, ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const coordKey = (p: LngLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/** Cut a polyline into `parts` pieces of equal length (metres, local frame); pieces share their end vertices. */
export function splitEqual(frame: Frame, coords: LngLat[], parts: number): LngLat[][] {
  if (parts <= 1 || coords.length < 2) return [coords];
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot(frame.x(coords[i][0]) - frame.x(coords[i - 1][0]), frame.y(coords[i][1]) - frame.y(coords[i - 1][1])));
  const total = cum[cum.length - 1];
  const at = (d: number): LngLat => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const span = cum[i] - cum[i - 1], t = span === 0 ? 0 : (d - cum[i - 1]) / span;
    return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
  };
  const out: LngLat[][] = [];
  for (let k = 0; k < parts; k++) {
    const from = (total * k) / parts, to = (total * (k + 1)) / parts;
    const piece: LngLat[] = [k === 0 ? coords[0] : at(from)];
    for (let i = 1; i < coords.length - 1; i++) if (cum[i] > from + 1e-9 && cum[i] < to - 1e-9) piece.push(coords[i]);
    piece.push(k === parts - 1 ? coords[coords.length - 1] : at(to));
    out.push(piece);
  }
  return out;
}
