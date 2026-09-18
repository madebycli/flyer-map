import type { PolygonGeometry } from './campaign.ts';
import {
  planStreetEngineV3ShardTransfer,
  type StreetEngineV3TransferPlan,
} from './streetEngineV3Budget.ts';

export const STREET_ENGINE_V3_SOURCE_SCHEMA_VERSION = 1 as const;
export const STREET_ENGINE_V3_BINARY_FORMAT = 'street-engine-v3-binary-shard-v1' as const;
export const STREET_ENGINE_V3_MAX_UNCOMPRESSED_SHARD_BYTES = 64 * 1024 * 1024;

export type StreetEngineV3Bounds = readonly [
  west: number,
  south: number,
  east: number,
  north: number,
];

export type StreetEngineV3FeatureCounts = {
  roads: number;
  buildings: number;
  addressableBuildings: number;
  /** Optional for schema-v1 compatibility; new packs must publish the exact node count. */
  addressNodes?: number;
  roadCandidates: number;
};

export type StreetEngineV3SourceShard = {
  /** Lowercase SHA-256 of the immutable compressed object bytes. */
  id: string;
  /** Shards never cross the antimeridian; a builder splits there if needed. */
  bounds: StreetEngineV3Bounds;
  compressedBytes: number;
  uncompressedBytes: number;
  counts: StreetEngineV3FeatureCounts;
};

export type StreetEngineV3SourceManifest = {
  schemaVersion: typeof STREET_ENGINE_V3_SOURCE_SCHEMA_VERSION;
  format: typeof STREET_ENGINE_V3_BINARY_FORMAT;
  coverageId: string;
  sourcePackVersion: string;
  algorithmVersion: string;
  source: {
    dataset: 'OpenStreetMap';
    provider: string;
    timestamp: string;
    license: string;
    attribution: string;
  };
  coverageBounds: StreetEngineV3Bounds[];
  shards: StreetEngineV3SourceShard[];
};

export type StreetEngineV3SourceSelection = {
  manifestHash: string;
  shards: StreetEngineV3SourceShard[];
  transfer: StreetEngineV3TransferPlan;
};

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function finiteInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validBounds(bounds: StreetEngineV3Bounds) {
  const [west, south, east, north] = bounds;
  return [west, south, east, north].every(Number.isFinite)
    && west >= -180 && east <= 180 && south >= -85 && north <= 85
    && west <= east && south <= north;
}

function validCounts(counts: StreetEngineV3FeatureCounts) {
  return finiteInteger(counts.roads)
    && finiteInteger(counts.buildings)
    && finiteInteger(counts.addressableBuildings)
    && (counts.addressNodes === undefined || finiteInteger(counts.addressNodes))
    && finiteInteger(counts.roadCandidates)
    && counts.addressableBuildings <= counts.buildings;
}

export function streetEngineV3SourceObjectKey(hash: string) {
  if (!SHA256.test(hash)) throw new Error('street_engine_v3_source_invalid_hash');
  return `source/v1/${hash.slice(0, 2)}/${hash}.bin`;
}

/**
 * Validates an untrusted manifest before it can influence object reads or
 * resource budgets. Source objects are addressed only by their digest, never
 * by a client-controlled URL.
 */
export function validateStreetEngineV3SourceManifest(
  manifest: StreetEngineV3SourceManifest,
): StreetEngineV3SourceManifest {
  if (manifest.schemaVersion !== STREET_ENGINE_V3_SOURCE_SCHEMA_VERSION) {
    throw new Error('street_engine_v3_source_schema_unsupported');
  }
  if (manifest.format !== STREET_ENGINE_V3_BINARY_FORMAT) {
    throw new Error('street_engine_v3_source_format_unsupported');
  }
  if (!SAFE_ID.test(manifest.coverageId)
    || !SAFE_ID.test(manifest.sourcePackVersion)
    || !SAFE_ID.test(manifest.algorithmVersion)) {
    throw new Error('street_engine_v3_source_invalid_identity');
  }
  if (manifest.source.dataset !== 'OpenStreetMap'
    || !manifest.source.provider.trim()
    || !manifest.source.license.trim()
    || !manifest.source.attribution.trim()
    || !ISO_UTC.test(manifest.source.timestamp)
    || Number.isNaN(Date.parse(manifest.source.timestamp))) {
    throw new Error('street_engine_v3_source_invalid_provenance');
  }
  if (!manifest.coverageBounds.length || manifest.coverageBounds.length > 64
    || manifest.coverageBounds.some((bounds) => !validBounds(bounds))) {
    throw new Error('street_engine_v3_source_invalid_coverage');
  }
  if (!manifest.shards.length || manifest.shards.length > 100_000) {
    throw new Error('street_engine_v3_source_invalid_shard_count');
  }

  const ids = new Set<string>();
  for (const shard of manifest.shards) {
    if (!SHA256.test(shard.id)
      || !validBounds(shard.bounds)
      || !finiteInteger(shard.compressedBytes)
      || !finiteInteger(shard.uncompressedBytes)
      || shard.uncompressedBytes > STREET_ENGINE_V3_MAX_UNCOMPRESSED_SHARD_BYTES
      || !validCounts(shard.counts)
      || ids.has(shard.id)) {
      throw new Error('street_engine_v3_source_invalid_shard');
    }
    ids.add(shard.id);
  }
  return manifest;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function canonicalStreetEngineV3SourceManifestJson(
  manifest: StreetEngineV3SourceManifest,
) {
  validateStreetEngineV3SourceManifest(manifest);
  const canonical = {
    ...manifest,
    coverageBounds: [...manifest.coverageBounds]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    shards: [...manifest.shards]
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return JSON.stringify(stableValue(canonical));
}

export async function streetEngineV3SourceManifestHash(
  manifest: StreetEngineV3SourceManifest,
) {
  const bytes = new TextEncoder().encode(canonicalStreetEngineV3SourceManifestJson(manifest));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizedLongitude(value: number) {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new Error('street_engine_v3_area_invalid_coordinate');
  }
  return value === 180 ? 180 : value;
}

/**
 * Returns one or two longitude intervals. Small polygons crossing the
 * antimeridian become two normal intervals instead of a near-worldwide bbox.
 */
function areaLongitudeIntervals(longitudes: number[]): [number, number][] {
  const normalized = longitudes.map(normalizedLongitude);
  const minimum = Math.min(...normalized);
  const maximum = Math.max(...normalized);
  if (maximum - minimum <= 180) return [[minimum, maximum]];

  const shifted = normalized.map((value) => value < 0 ? value + 360 : value);
  const shiftedMinimum = Math.min(...shifted);
  const shiftedMaximum = Math.max(...shifted);
  if (shiftedMaximum - shiftedMinimum > 180) {
    throw new Error('street_engine_v3_area_too_wide');
  }
  if (shiftedMaximum <= 180) return [[shiftedMinimum, shiftedMaximum]];
  if (shiftedMinimum >= 180) return [[shiftedMinimum - 360, shiftedMaximum - 360]];
  return [[shiftedMinimum, 180], [-180, shiftedMaximum - 360]];
}

function areaBounds(geometry: PolygonGeometry): StreetEngineV3Bounds[] {
  const points = geometry.coordinates.flat();
  if (points.length < 4) throw new Error('street_engine_v3_area_invalid_polygon');
  const latitudes = points.map((point) => {
    const latitude = point[1];
    if (!Number.isFinite(latitude) || latitude < -85 || latitude > 85) {
      throw new Error('street_engine_v3_area_invalid_coordinate');
    }
    return latitude;
  });
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  return areaLongitudeIntervals(points.map((point) => point[0]))
    .map(([west, east]) => [west, south, east, north] as const);
}

function intersects(left: StreetEngineV3Bounds, right: StreetEngineV3Bounds) {
  return left[0] <= right[2] && left[2] >= right[0]
    && left[1] <= right[3] && left[3] >= right[1];
}

export async function selectStreetEngineV3SourceShards(
  manifest: StreetEngineV3SourceManifest,
  area: PolygonGeometry,
): Promise<StreetEngineV3SourceSelection> {
  validateStreetEngineV3SourceManifest(manifest);
  const requestedBounds = areaBounds(area);
  const coverageIntersects = manifest.coverageBounds.some((coverage) =>
    requestedBounds.some((requested) => intersects(coverage, requested)));
  if (!coverageIntersects) throw new Error('street_engine_v3_source_outside_coverage');

  const shards = manifest.shards.filter((shard) =>
    requestedBounds.some((requested) => intersects(shard.bounds, requested)));
  if (!shards.length) throw new Error('street_engine_v3_source_missing_shards');

  const transfer = planStreetEngineV3ShardTransfer(
    shards.map((shard) => ({ id: shard.id, compressedBytes: shard.compressedBytes })),
  );
  return {
    manifestHash: await streetEngineV3SourceManifestHash(manifest),
    shards,
    transfer,
  };
}
