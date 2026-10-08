import { frameFor, projectToPolyline } from './geo.ts';
import type { LngLat, Network } from './types.ts';

type LegacyStatus = 'open' | 'completed' | 'later' | 'not-deliverable';
/** The parts of the pre-v5 snapshot the import needs (structural, so no dependency on legacy modules). */
export type LegacySnapshot = {
  tasks?: {
    status: LegacyStatus;
    geometry: { type: 'LineString'; coordinates: LngLat[] };
    source?: { objectType?: string; objectIds?: number[] } | null;
    network?: { length: number; coverage: { from: number; to: number; status: LegacyStatus }[] };
  }[];
  houseTasks?: { status: LegacyStatus; source?: { objectType?: string; objectIds?: number[] } | null }[];
};

export type LegacyImport = {
  houses: Map<string, LegacyStatus>;
  segments: Map<string, LegacyStatus>;
  stats: { housesMatched: number; housesUnmatched: number; streetRangesMatched: number; streetRangesUnmatched: number };
};

/** How close (m) a v5 segment midpoint must lie to the legacy fragment to count as the same road piece. */
const SNAP_METERS = 4;

/**
 * Best-effort carry-over of field progress. Houses match by OSM id (`h<way>` / `a<node>`);
 * street progress matches by OSM way id plus position along the legacy fragment, because
 * v5 segments are split at junctions while legacy tasks were clipped fragments.
 */
export function importLegacyProgress(network: Network, legacy: LegacySnapshot): LegacyImport {
  const result: LegacyImport = { houses: new Map(), segments: new Map(), stats: { housesMatched: 0, housesUnmatched: 0, streetRangesMatched: 0, streetRangesUnmatched: 0 } };
  const houseIds = new Set(network.houses.map((h) => h.id));
  for (const task of legacy.houseTasks ?? []) {
    if (task.status === 'open') continue;
    const osmId = task.source?.objectIds?.[0];
    const id = osmId === undefined ? null : task.source?.objectType === 'node' ? `a${osmId}` : `h${osmId}`;
    if (id && houseIds.has(id)) { result.houses.set(`h:${id}`, task.status); result.stats.housesMatched++; } else result.stats.housesUnmatched++;
  }

  const byWay = new Map<number, Network['segments']>();
  for (const segment of network.segments) { const list = byWay.get(segment.wayId); if (list) list.push(segment); else byWay.set(segment.wayId, [segment]); }
  const frame = frameFor(network.segments.flatMap((s) => s.coords.slice(0, 1)));
  for (const task of legacy.tasks ?? []) {
    const wayId = task.source?.objectIds?.[0];
    const segments = wayId === undefined ? undefined : byWay.get(wayId);
    const length = task.network?.length;
    const ranges = task.network ? task.network.coverage : task.status === 'open' ? [] : [{ from: 0, to: Number.POSITIVE_INFINITY, status: task.status }];
    const line = task.geometry.coordinates.map((p) => frame.toXY(p));
    for (const range of ranges) {
      if (range.status === 'open') continue;
      if (!segments) { result.stats.streetRangesUnmatched++; continue; }
      let hit = 0;
      for (const segment of segments) {
        // Midpoint by length is more robust than a vertex for long straight segments.
        const projection = projectToPolyline(line, frame.toXY(midpointByLength(segment.coords) ?? segment.coords[0]));
        if (projection.distance > SNAP_METERS) continue;
        if (projection.measure < range.from - 1 || projection.measure > Math.min(range.to, length ?? Infinity) + 1) continue;
        result.segments.set(`s:${segment.id}`, range.status);
        hit++;
      }
      if (hit) result.stats.streetRangesMatched++; else result.stats.streetRangesUnmatched++;
    }
  }
  return result;
}

function midpointByLength(coords: LngLat[]): LngLat | null {
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
