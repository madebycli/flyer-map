import type { PolygonGeometry, LngLat } from '../../src/domain/campaign.ts';
import {
  canonicalStreetEngineV3SourceManifestJson,
  selectStreetEngineV3SourceShards,
  streetEngineV3SourceManifestHash,
  streetEngineV3SourceObjectKey,
  validateStreetEngineV3SourceManifest,
  type StreetEngineV3Bounds,
  type StreetEngineV3SourceManifest,
  type StreetEngineV3SourceShard,
} from '../../src/domain/streetEngineV3SourcePack.ts';
import type { AddressNode, AddressBuilding } from './addresses.ts';
import type { RoadInput } from './geometry.ts';

const POINTER_SCHEMA_VERSION = 1 as const;
const SHARD_SCHEMA_VERSION = 1 as const;
const SHARD_MAGIC = new TextEncoder().encode('FMSEV3\0');
const SAFE_CHANNEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_DECODED_SHARD_BYTES = 64 * 1024 * 1024;

export type StreetEngineV3SourcePointer = {
  schemaVersion: typeof POINTER_SCHEMA_VERSION;
  channel: string;
  manifestHash: string;
};

export type StreetEngineV3ShardPayload = {
  schemaVersion: typeof SHARD_SCHEMA_VERSION;
  bounds: StreetEngineV3Bounds;
  roads: RoadInput[];
  buildings: AddressBuilding[];
  addressNodes: AddressNode[];
};

export type StreetEngineV3Object = {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

export type StreetEngineV3Bucket = {
  get(key: string): Promise<StreetEngineV3Object | null>;
  put?(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: unknown): Promise<unknown>;
};

export type StreetEngineV3LoadedSource = {
  manifest: StreetEngineV3SourceManifest;
  manifestHash: string;
  roads: RoadInput[];
  buildings: AddressBuilding[];
  addressNodes: AddressNode[];
  diagnostics: {
    engineVersion: 'sourcepack-v3';
    manifestHash: string;
    sourcePackVersion: string;
    algorithmVersion: string;
    sourceTimestamp: string;
    selectedShardIds: string[];
    shardCount: number;
    objectGets: number;
    compressedBytes: number;
    decodedBytes: number;
    cacheHits: 0;
    cacheMisses: number;
    legacyOverpassRequests: 0;
  };
};

function assertSafeChannel(channel: string) {
  if (!SAFE_CHANNEL.test(channel)) throw new Error('street_engine_v3_source_invalid_channel');
  return channel;
}

export function streetEngineV3PointerKey(channel: string) {
  return `source/v1/channels/${assertSafeChannel(channel)}.json`;
}

export function streetEngineV3ManifestObjectKey(hash: string) {
  if (!SHA256.test(hash)) throw new Error('street_engine_v3_source_invalid_hash');
  return `source/v1/manifests/${hash}.json`;
}

function validBounds(bounds: StreetEngineV3Bounds) {
  const [west, south, east, north] = bounds;
  return [west, south, east, north].every(Number.isFinite)
    && west >= -180 && east <= 180 && south >= -85 && north <= 85
    && west <= east && south <= north;
}

function sameBounds(left: StreetEngineV3Bounds, right: StreetEngineV3Bounds) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pointInside(bounds: StreetEngineV3Bounds, point: LngLat) {
  return point[0] >= bounds[0] && point[0] <= bounds[2]
    && point[1] >= bounds[1] && point[1] <= bounds[3];
}

function validateTagMap(tags: Record<string, string>) {
  const entries = Object.entries(tags);
  if (entries.length > 256) throw new Error('street_engine_v3_shard_invalid_tags');
  for (const [key, value] of entries) {
    if (!key || key.length > 128 || typeof value !== 'string' || value.length > 2048) {
      throw new Error('street_engine_v3_shard_invalid_tags');
    }
  }
}

function validateRoad(road: RoadInput, bounds: StreetEngineV3Bounds) {
  if (!Number.isSafeInteger(road.osmId) || road.osmId <= 0) throw new Error('street_engine_v3_shard_invalid_road');
  validateTagMap(road.tags);
  const lines: LngLat[][] = road.geometry.type === 'LineString'
    ? [road.geometry.coordinates]
    : road.geometry.type === 'MultiLineString'
      ? road.geometry.coordinates
      : road.geometry.geometries.flatMap((geometry) => geometry.type === 'LineString'
        ? [geometry.coordinates]
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates
          : []);
  if (!lines.length) throw new Error('street_engine_v3_shard_invalid_road');
  for (const line of lines) {
    if (line.length < 2 || line.some((point) => !pointInside(bounds, point))) {
      throw new Error('street_engine_v3_shard_bounds_mismatch');
    }
  }
}

function validateBuilding(building: AddressBuilding, bounds: StreetEngineV3Bounds) {
  if (!Number.isSafeInteger(building.osmId) || building.osmId <= 0) throw new Error('street_engine_v3_shard_invalid_building');
  validateTagMap(building.tags);
  const rings = building.geometry.coordinates;
  if (!rings.length || rings[0].length < 4) throw new Error('street_engine_v3_shard_invalid_building');
  for (const ring of rings) {
    if (ring.length < 4 || ring.some((point) => !pointInside(bounds, point))) {
      throw new Error('street_engine_v3_shard_bounds_mismatch');
    }
    const first = ring[0];
    const last = ring.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('street_engine_v3_shard_invalid_building');
  }
}

function validateAddressNode(node: AddressNode, bounds: StreetEngineV3Bounds) {
  if (!Number.isSafeInteger(node.osmId) || node.osmId <= 0 || !pointInside(bounds, node.point)) {
    throw new Error('street_engine_v3_shard_bounds_mismatch');
  }
  validateTagMap(node.tags);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function canonicalShardPayload(payload: StreetEngineV3ShardPayload) {
  return JSON.stringify(stableValue({
    schemaVersion: payload.schemaVersion,
    bounds: payload.bounds,
    roads: [...payload.roads].sort((left, right) => left.osmId - right.osmId),
    buildings: [...payload.buildings].sort((left, right) => left.osmId - right.osmId),
    addressNodes: [...payload.addressNodes].sort((left, right) => left.osmId - right.osmId),
  }));
}

function ownedBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function transformBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const writer = stream.writable.getWriter();
  await writer.write(ownedBytes(bytes));
  await writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    size += part.value.byteLength;
    if (size > MAX_DECODED_SHARD_BYTES) throw new Error('street_engine_v3_shard_decode_budget');
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', ownedBytes(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function encodeStreetEngineV3Shard(payload: StreetEngineV3ShardPayload) {
  if (payload.schemaVersion !== SHARD_SCHEMA_VERSION || !validBounds(payload.bounds)) {
    throw new Error('street_engine_v3_shard_invalid_header');
  }
  payload.roads.forEach((road) => validateRoad(road, payload.bounds));
  payload.buildings.forEach((building) => validateBuilding(building, payload.bounds));
  payload.addressNodes.forEach((node) => validateAddressNode(node, payload.bounds));
  const body = new TextEncoder().encode(canonicalShardPayload(payload));
  const frame = new Uint8Array(SHARD_MAGIC.byteLength + 4 + body.byteLength);
  frame.set(SHARD_MAGIC, 0);
  new DataView(frame.buffer).setUint32(SHARD_MAGIC.byteLength, body.byteLength, true);
  frame.set(body, SHARD_MAGIC.byteLength + 4);
  const compressed = await transformBytes(frame, new CompressionStream('gzip'));
  return { bytes: compressed, uncompressedBytes: frame.byteLength, id: await sha256Bytes(compressed) };
}

async function decodeStreetEngineV3Shard(bytes: Uint8Array, descriptor: StreetEngineV3SourceShard) {
  if (bytes.byteLength !== descriptor.compressedBytes) throw new Error('street_engine_v3_shard_size_mismatch');
  if (await sha256Bytes(bytes) !== descriptor.id) throw new Error('street_engine_v3_shard_hash_mismatch');
  let frame: Uint8Array;
  try {
    frame = await transformBytes(bytes, new DecompressionStream('gzip'));
  } catch (error) {
    if (error instanceof Error && error.message === 'street_engine_v3_shard_decode_budget') throw error;
    throw new Error('street_engine_v3_shard_decode_failure');
  }
  if (frame.byteLength !== descriptor.uncompressedBytes) throw new Error('street_engine_v3_shard_decoded_size_mismatch');
  if (frame.byteLength < SHARD_MAGIC.byteLength + 4) throw new Error('street_engine_v3_shard_decode_failure');
  for (let index = 0; index < SHARD_MAGIC.byteLength; index++) {
    if (frame[index] !== SHARD_MAGIC[index]) throw new Error('street_engine_v3_shard_magic_mismatch');
  }
  const payloadBytes = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(SHARD_MAGIC.byteLength, true);
  if (payloadBytes !== frame.byteLength - SHARD_MAGIC.byteLength - 4) throw new Error('street_engine_v3_shard_decode_failure');
  let payload: StreetEngineV3ShardPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(frame.subarray(SHARD_MAGIC.byteLength + 4))) as StreetEngineV3ShardPayload;
  } catch {
    throw new Error('street_engine_v3_shard_decode_failure');
  }
  if (payload.schemaVersion !== SHARD_SCHEMA_VERSION || !sameBounds(payload.bounds, descriptor.bounds)) {
    throw new Error('street_engine_v3_shard_bounds_mismatch');
  }
  if (!Array.isArray(payload.roads) || !Array.isArray(payload.buildings) || !Array.isArray(payload.addressNodes)) {
    throw new Error('street_engine_v3_shard_decode_failure');
  }
  payload.roads.forEach((road) => validateRoad(road, descriptor.bounds));
  payload.buildings.forEach((building) => validateBuilding(building, descriptor.bounds));
  payload.addressNodes.forEach((node) => validateAddressNode(node, descriptor.bounds));
  if (payload.roads.length !== descriptor.counts.roads
    || payload.buildings.length !== descriptor.counts.buildings
    || (descriptor.counts.addressNodes !== undefined
      && payload.addressNodes.length !== descriptor.counts.addressNodes)) {
    throw new Error('street_engine_v3_shard_count_mismatch');
  }
  return { payload, decodedBytes: frame.byteLength };
}

function parsePointer(raw: string, expectedChannel: string): StreetEngineV3SourcePointer {
  let pointer: StreetEngineV3SourcePointer;
  try { pointer = JSON.parse(raw) as StreetEngineV3SourcePointer; }
  catch { throw new Error('street_engine_v3_pointer_invalid'); }
  if (pointer.schemaVersion !== POINTER_SCHEMA_VERSION
    || pointer.channel !== expectedChannel
    || !SHA256.test(pointer.manifestHash)) {
    throw new Error('street_engine_v3_pointer_invalid');
  }
  return pointer;
}

async function loadManifestByHash(bucket: StreetEngineV3Bucket, hash: string) {
  const object = await bucket.get(streetEngineV3ManifestObjectKey(hash));
  if (!object) throw new Error('street_engine_v3_manifest_missing');
  const raw = await object.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_MANIFEST_BYTES) throw new Error('street_engine_v3_manifest_budget');
  let manifest: StreetEngineV3SourceManifest;
  try { manifest = JSON.parse(raw) as StreetEngineV3SourceManifest; }
  catch { throw new Error('street_engine_v3_manifest_invalid'); }
  validateStreetEngineV3SourceManifest(manifest);
  const actual = await streetEngineV3SourceManifestHash(manifest);
  if (actual !== hash) throw new Error('street_engine_v3_manifest_hash_mismatch');
  if (canonicalStreetEngineV3SourceManifestJson(manifest) !== raw) throw new Error('street_engine_v3_manifest_not_canonical');
  return manifest;
}

function mergeUnique<T extends { osmId: number }>(target: Map<number, T>, rows: T[], conflictCode: string) {
  for (const row of rows) {
    const prior = target.get(row.osmId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error(conflictCode);
    target.set(row.osmId, row);
  }
}

export async function resolveStreetEngineV3Manifest(
  bucket: StreetEngineV3Bucket,
  channel: string,
  pinnedManifestHash?: string,
) {
  const safeChannel = assertSafeChannel(channel);
  if (pinnedManifestHash) {
    if (!SHA256.test(pinnedManifestHash)) throw new Error('street_engine_v3_source_invalid_hash');
    return { manifestHash: pinnedManifestHash, manifest: await loadManifestByHash(bucket, pinnedManifestHash), objectGets: 1 };
  }
  const pointerObject = await bucket.get(streetEngineV3PointerKey(safeChannel));
  if (!pointerObject) throw new Error('street_engine_v3_pointer_missing');
  const pointer = parsePointer(await pointerObject.text(), safeChannel);
  return { manifestHash: pointer.manifestHash, manifest: await loadManifestByHash(bucket, pointer.manifestHash), objectGets: 2 };
}

export async function loadStreetEngineV3Source(input: {
  bucket: StreetEngineV3Bucket;
  channel: string;
  area: PolygonGeometry;
  pinnedManifestHash?: string;
}): Promise<StreetEngineV3LoadedSource> {
  const resolved = await resolveStreetEngineV3Manifest(input.bucket, input.channel, input.pinnedManifestHash);
  const selection = await selectStreetEngineV3SourceShards(resolved.manifest, input.area);
  if (selection.manifestHash !== resolved.manifestHash) throw new Error('street_engine_v3_manifest_hash_mismatch');
  if (selection.transfer.status === 'blocked') throw new Error('street_engine_v3_source_transfer_budget');

  const roads = new Map<number, RoadInput>();
  const buildings = new Map<number, AddressBuilding>();
  const addressNodes = new Map<number, AddressNode>();
  let decodedBytes = 0;
  let objectGets = resolved.objectGets;
  for (const shard of selection.shards) {
    const object = await input.bucket.get(streetEngineV3SourceObjectKey(shard.id));
    objectGets += 1;
    if (!object) throw new Error('street_engine_v3_shard_missing');
    const bytes = new Uint8Array(await object.arrayBuffer());
    const decoded = await decodeStreetEngineV3Shard(bytes, shard);
    decodedBytes += decoded.decodedBytes;
    if (decodedBytes > MAX_DECODED_SHARD_BYTES) throw new Error('street_engine_v3_shard_decode_budget');
    mergeUnique(roads, decoded.payload.roads, 'street_engine_v3_road_conflict');
    mergeUnique(buildings, decoded.payload.buildings, 'street_engine_v3_building_conflict');
    mergeUnique(addressNodes, decoded.payload.addressNodes, 'street_engine_v3_address_conflict');
  }

  return {
    manifest: resolved.manifest,
    manifestHash: resolved.manifestHash,
    roads: [...roads.values()].sort((left, right) => left.osmId - right.osmId),
    buildings: [...buildings.values()].sort((left, right) => left.osmId - right.osmId),
    addressNodes: [...addressNodes.values()].sort((left, right) => left.osmId - right.osmId),
    diagnostics: {
      engineVersion: 'sourcepack-v3',
      manifestHash: resolved.manifestHash,
      sourcePackVersion: resolved.manifest.sourcePackVersion,
      algorithmVersion: resolved.manifest.algorithmVersion,
      sourceTimestamp: resolved.manifest.source.timestamp,
      selectedShardIds: selection.shards.map((shard) => shard.id),
      shardCount: selection.shards.length,
      objectGets,
      compressedBytes: selection.transfer.downloadBytes,
      decodedBytes,
      cacheHits: 0,
      cacheMisses: selection.shards.length,
      legacyOverpassRequests: 0,
    },
  };
}
