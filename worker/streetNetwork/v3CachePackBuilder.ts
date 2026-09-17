import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  type StreetEngineV3Bounds,
  type StreetEngineV3SourceManifest,
} from '../../src/domain/streetEngineV3SourcePack.ts';
import { addressBuildings, type AddressBuilding, type AddressNode } from './addresses.ts';
import type { RoadInput } from './geometry.ts';
import { encodeStreetEngineV3Shard, sha256Bytes } from './v3SourceRuntime.ts';

export type StreetEngineV3CacheRow = {
  cache_key: string;
  part: number;
  cached_at: string;
  payload_json: string;
};

export type StreetEngineV3BuiltCachePack = {
  manifest: StreetEngineV3SourceManifest;
  manifestHash: string;
  manifestJson: string;
  shardObjects: Map<string, Uint8Array>;
};

type CacheMeta = {
  parts: number;
  value: {
    sourceTimestamp?: string;
  };
};

type CacheValue = {
  kind: 'feature' | 'address';
  value: unknown;
};

type CacheGroup = {
  cacheKey: string;
  sourceTimestamp: string;
  roads: RoadInput[];
  buildings: AddressBuilding[];
  addressNodes: AddressNode[];
};

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function parseObject(raw: string, code: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error(code);
    return parsed;
  } catch {
    throw new Error(code);
  }
}

function parseCacheGroup(cacheKey: string, rows: StreetEngineV3CacheRow[]): CacheGroup | null {
  const ordered = [...rows].sort((left, right) => left.part - right.part);
  const metaRow = ordered.find((row) => row.part === -1);
  if (!metaRow) throw new Error('street_engine_v3_cache_meta_missing');
  const meta = parseObject(metaRow.payload_json, 'street_engine_v3_cache_meta_invalid') as CacheMeta;
  const parts = ordered.filter((row) => row.part >= 0);
  if (!Number.isSafeInteger(meta.parts) || meta.parts < 0 || meta.parts !== parts.length) {
    throw new Error('street_engine_v3_cache_parts_mismatch');
  }
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].part !== index) throw new Error('street_engine_v3_cache_parts_mismatch');
  }
  if (!meta.value || typeof meta.value !== 'object'
    || typeof meta.value.sourceTimestamp !== 'string'
    || !ISO_UTC.test(meta.value.sourceTimestamp)
    || Number.isNaN(Date.parse(meta.value.sourceTimestamp))) {
    throw new Error('street_engine_v3_cache_source_timestamp_missing');
  }

  const values: CacheValue[] = [];
  for (const row of parts) {
    let chunk: unknown;
    try { chunk = JSON.parse(row.payload_json); }
    catch { throw new Error('street_engine_v3_cache_part_invalid'); }
    if (!Array.isArray(chunk)) throw new Error('street_engine_v3_cache_part_invalid');
    for (const item of chunk) {
      if (!item || typeof item !== 'object') throw new Error('street_engine_v3_cache_part_invalid');
      const candidate = item as Partial<CacheValue>;
      if ((candidate.kind !== 'feature' && candidate.kind !== 'address') || !candidate.value || typeof candidate.value !== 'object') {
        throw new Error('street_engine_v3_cache_part_invalid');
      }
      values.push(candidate as CacheValue);
    }
  }

  const roads: RoadInput[] = [];
  const buildings: AddressBuilding[] = [];
  const addressNodes: AddressNode[] = [];
  for (const item of values) {
    if (item.kind === 'address') {
      addressNodes.push(item.value as AddressNode);
      continue;
    }
    const feature = item.value as { geometry?: { type?: string } };
    const type = feature.geometry?.type;
    if (type === 'Polygon') buildings.push(item.value as AddressBuilding);
    else if (type === 'LineString' || type === 'MultiLineString' || type === 'GeometryCollection') roads.push(item.value as RoadInput);
    else throw new Error('street_engine_v3_cache_feature_kind_unknown');
  }
  if (!roads.length && !buildings.length && !addressNodes.length) return null;
  return { cacheKey, sourceTimestamp: meta.value.sourceTimestamp, roads, buildings, addressNodes };
}

function geometryPoints(geometry: RoadInput['geometry'] | AddressBuilding['geometry']): [number, number][] {
  if (geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap((nested) => geometryPoints(nested));
  return [];
}

function groupBounds(group: CacheGroup): StreetEngineV3Bounds {
  const points: [number, number][] = [];
  for (const road of group.roads) points.push(...geometryPoints(road.geometry));
  for (const building of group.buildings) points.push(...geometryPoints(building.geometry));
  for (const node of group.addressNodes) points.push(node.point);
  if (!points.length) throw new Error('street_engine_v3_cache_empty_group');
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  if (![west, south, east, north].every(Number.isFinite)
    || west < -180 || east > 180 || south < -85 || north > 85
    || east - west > 180) {
    throw new Error('street_engine_v3_cache_bounds_invalid');
  }
  return [west, south, east, north];
}

function mergeConsistent<T extends { osmId: number }>(target: Map<number, T>, rows: T[], code: string) {
  for (const row of rows) {
    const prior = target.get(row.osmId);
    if (prior && stableJson(prior) !== stableJson(row)) throw new Error(code);
    target.set(row.osmId, row);
  }
}

export async function buildStreetEngineV3CachePack(rows: StreetEngineV3CacheRow[]): Promise<StreetEngineV3BuiltCachePack> {
  if (!rows.length) throw new Error('street_engine_v3_cache_empty');
  const grouped = new Map<string, StreetEngineV3CacheRow[]>();
  for (const row of rows) {
    if (!row || typeof row.cache_key !== 'string' || !row.cache_key
      || !Number.isSafeInteger(row.part) || typeof row.payload_json !== 'string') {
      throw new Error('street_engine_v3_cache_row_invalid');
    }
    const values = grouped.get(row.cache_key) ?? [];
    values.push(row);
    grouped.set(row.cache_key, values);
  }

  const groups = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cacheKey, groupRows]) => parseCacheGroup(cacheKey, groupRows))
    .filter((group): group is CacheGroup => group !== null);
  if (!groups.length) throw new Error('street_engine_v3_cache_no_features');
  if (groups.length > 64) throw new Error('street_engine_v3_cache_too_many_groups');

  const allRoads = new Map<number, RoadInput>();
  const allBuildings = new Map<number, AddressBuilding>();
  const allAddressNodes = new Map<number, AddressNode>();
  for (const group of groups) {
    mergeConsistent(allRoads, group.roads, 'street_engine_v3_cache_road_conflict');
    mergeConsistent(allBuildings, group.buildings, 'street_engine_v3_cache_building_conflict');
    mergeConsistent(allAddressNodes, group.addressNodes, 'street_engine_v3_cache_address_conflict');
  }
  const addressableIds = new Set(
    addressBuildings([...allBuildings.values()], [...allAddressNodes.values()]).map((building) => building.osmId),
  );

  const shardObjects = new Map<string, Uint8Array>();
  const shards = [];
  for (const group of groups) {
    const bounds = groupBounds(group);
    const encoded = await encodeStreetEngineV3Shard({
      schemaVersion: 1,
      bounds,
      roads: group.roads,
      buildings: group.buildings,
      addressNodes: group.addressNodes,
    });
    const prior = shardObjects.get(encoded.id);
    if (prior && stableJson([...prior]) !== stableJson([...encoded.bytes])) {
      throw new Error('street_engine_v3_cache_shard_hash_collision');
    }
    shardObjects.set(encoded.id, encoded.bytes);
    shards.push({
      id: encoded.id,
      bounds,
      compressedBytes: encoded.bytes.byteLength,
      uncompressedBytes: encoded.uncompressedBytes,
      counts: {
        roads: group.roads.length,
        buildings: group.buildings.length,
        addressableBuildings: group.buildings.filter((building) => addressableIds.has(building.osmId)).length,
        addressNodes: group.addressNodes.length,
        roadCandidates: group.roads.length,
      },
    });
  }

  const identityBytes = new TextEncoder().encode(shards.map((shard) => shard.id).sort().join(':'));
  const packIdentity = (await sha256Bytes(identityBytes)).slice(0, 24);
  const sourceTimestamp = groups.map((group) => group.sourceTimestamp).sort()[0];
  const manifest: StreetEngineV3SourceManifest = {
    schemaVersion: 1,
    format: 'street-engine-v3-binary-shard-v1',
    coverageId: 'beta-d1-source-cache',
    sourcePackVersion: `cache-${packIdentity}`,
    algorithmVersion: 'v3-cache-builder-1',
    source: {
      dataset: 'OpenStreetMap',
      provider: 'beta-d1-source-cache',
      timestamp: sourceTimestamp,
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
    },
    coverageBounds: shards.map((shard) => shard.bounds),
    shards,
  };
  const manifestJson = canonicalStreetEngineV3SourceManifestJson(manifest);
  const manifestHash = await streetEngineV3SourceManifestHash(manifest);
  return { manifest, manifestHash, manifestJson, shardObjects };
}
