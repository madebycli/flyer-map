import { AREA_MAX_VERTICES, validateAreaPolygonVertices, type GeometryValidation } from '../../domain/geometry.ts';
import type { LngLat } from '../engine/types.ts';

/** Area polygons are edited as an OPEN vertex list (no repeated first point) and stored as a closed GeoJSON ring. */
export type Vertices = LngLat[];

export const MAX_VERTICES = AREA_MAX_VERTICES;

export function fromRing(ring: LngLat[]): Vertices {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  return open.map((p) => [p[0], p[1]]);
}

export function toRing(vertices: Vertices): LngLat[] {
  return vertices.length ? [...vertices.map((p): LngLat => [p[0], p[1]]), [vertices[0][0], vertices[0][1]]] : [];
}

export function toPolygon(vertices: Vertices): { type: 'Polygon'; coordinates: LngLat[][] } {
  return { type: 'Polygon', coordinates: [toRing(vertices)] };
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Handles for inserting a vertex in the middle of each edge (edge i runs from vertex i to i+1). */
export function midpoints(vertices: Vertices): { edge: number; point: LngLat }[] {
  return vertices.length < 2 ? [] : vertices.map((v, i) => ({ edge: i, point: midpoint(v, vertices[(i + 1) % vertices.length]) }));
}

export function moveVertex(vertices: Vertices, index: number, to: LngLat): Vertices {
  return vertices.map((v, i): LngLat => (i === index ? [to[0], to[1]] : v));
}

/** Inserts after edge `edge`; returns the new list and the index of the new vertex. Refuses beyond the Area limit. */
export function insertVertex(vertices: Vertices, edge: number, at: LngLat): { vertices: Vertices; index: number } | null {
  if (vertices.length >= MAX_VERTICES) return null;
  const index = edge + 1;
  return { vertices: [...vertices.slice(0, index), [at[0], at[1]], ...vertices.slice(index)], index };
}

export function removeVertex(vertices: Vertices, index: number): Vertices | null {
  return vertices.length <= 3 ? null : vertices.filter((_, i) => i !== index);
}

export function validate(vertices: Vertices): GeometryValidation {
  return validateAreaPolygonVertices(vertices);
}

/** Rough area in m² (local equirectangular), for the size readout and the Overpass budget. */
export function areaSquareMeters(vertices: Vertices): number {
  if (vertices.length < 3) return 0;
  const lat0 = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_574;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    sum += a[0] * kx * (b[1] * ky) - b[0] * kx * (a[1] * ky);
  }
  return Math.abs(sum) / 2;
}

/** Counter-clockwise ring reads the same for everyone; a clicked polygon may come either way round. */
export function isSamePolygon(a: Vertices, b: Vertices): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

/** Vertices of a small square around a tapped point, used as the seed of a new Area. */
export function seedSquare(center: LngLat, meters = 120): Vertices {
  const dLat = meters / 110_574, dLng = meters / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [[center[0] - dLng, center[1] - dLat], [center[0] + dLng, center[1] - dLat], [center[0] + dLng, center[1] + dLat], [center[0] - dLng, center[1] + dLat]];
}
