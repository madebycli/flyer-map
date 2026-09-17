import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStreetEngineV3CachePack, type StreetEngineV3CacheRow } from '../worker/streetNetwork/v3CachePackBuilder.ts';
import { publishStreetEngineV3SourcePack } from '../worker/streetNetwork/v3SourcePublisher.ts';
import { loadStreetEngineV3Source, type StreetEngineV3Bucket, type StreetEngineV3Object } from '../worker/streetNetwork/v3SourceRuntime.ts';

class MemoryObject implements StreetEngineV3Object {
  constructor(private readonly bytes: Uint8Array) {}
  async arrayBuffer() { return this.bytes.slice().buffer; }
  async text() { return new TextDecoder().decode(this.bytes); }
}

class MemoryBucket implements StreetEngineV3Bucket {
  readonly values = new Map<string, Uint8Array>();
  async get(key: string) {
    const value = this.values.get(key);
    return value ? new MemoryObject(value) : null;
  }
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string) {
    let bytes: Uint8Array;
    if (typeof value === 'string') bytes = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
    else bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    this.values.set(key, bytes);
  }
}

const timestamp = '2026-09-17T10:00:00Z';
const cachedAt = '2026-09-17T10:05:00Z';

function cacheRows(): StreetEngineV3CacheRow[] {
  const road = {
    osmId: 1,
    tags: { highway: 'residential', name: 'Straße' },
    geometry: { type: 'LineString', coordinates: [[13.001, 51.005], [13.009, 51.005]] },
  };
  const building = {
    osmId: 100,
    tags: { building: 'house', 'addr:street': 'Straße', 'addr:housenumber': '1' },
    geometry: { type: 'Polygon', coordinates: [[[13.002, 51.0051], [13.0022, 51.0051], [13.0022, 51.0053], [13.002, 51.0051]]] },
  };
  const address = {
    osmId: 200,
    point: [13.0021, 51.0052],
    tags: { 'addr:street': 'Straße', 'addr:housenumber': '1' },
  };
  return [
    { cache_key: 'roads-cache', part: -1, cached_at: cachedAt, payload_json: JSON.stringify({ parts: 1, value: { sourceTimestamp: timestamp } }) },
    { cache_key: 'roads-cache', part: 0, cached_at: cachedAt, payload_json: JSON.stringify([{ kind: 'feature', value: road }]) },
    { cache_key: 'buildings-cache', part: -1, cached_at: cachedAt, payload_json: JSON.stringify({ parts: 1, value: { sourceTimestamp: timestamp } }) },
    { cache_key: 'buildings-cache', part: 0, cached_at: cachedAt, payload_json: JSON.stringify([{ kind: 'feature', value: building }, { kind: 'address', value: address }]) },
  ];
}

const area = {
  type: 'Polygon',
  coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
} as const;

test('V3 cache builder creates deterministic exact-count source packs', async () => {
  const left = await buildStreetEngineV3CachePack(cacheRows());
  const right = await buildStreetEngineV3CachePack(cacheRows().reverse());
  assert.equal(left.manifestHash, right.manifestHash);
  assert.equal(left.manifest.source.provider, 'beta-d1-source-cache');
  assert.equal(left.manifest.shards.length, 2);
  assert.equal(left.manifest.shards.reduce((sum, shard) => sum + (shard.counts.addressNodes ?? 0), 0), 1);
  assert.equal(left.manifest.shards.reduce((sum, shard) => sum + shard.counts.roads, 0), 1);
  assert.equal(left.manifest.shards.reduce((sum, shard) => sum + shard.counts.buildings, 0), 1);
});

test('cache-built pack publishes atomically and V3 loads it with zero legacy Overpass requests', async () => {
  const pack = await buildStreetEngineV3CachePack(cacheRows());
  const bucket = new MemoryBucket();
  await publishStreetEngineV3SourcePack({
    bucket,
    channel: 'beta',
    manifest: pack.manifest,
    shardObjects: pack.shardObjects,
  });
  const loaded = await loadStreetEngineV3Source({ bucket, channel: 'beta', area });
  assert.equal(loaded.roads.length, 1);
  assert.equal(loaded.buildings.length, 1);
  assert.equal(loaded.addressNodes.length, 1);
  assert.equal(loaded.diagnostics.engineVersion, 'sourcepack-v3');
  assert.equal(loaded.diagnostics.legacyOverpassRequests, 0);
  assert.equal(loaded.manifestHash, pack.manifestHash);
});

test('cache builder fails closed on conflicting duplicate OSM ids', async () => {
  const rows = cacheRows();
  rows.push(
    { cache_key: 'conflict-cache', part: -1, cached_at: cachedAt, payload_json: JSON.stringify({ parts: 1, value: { sourceTimestamp: timestamp } }) },
    { cache_key: 'conflict-cache', part: 0, cached_at: cachedAt, payload_json: JSON.stringify([{ kind: 'feature', value: {
      osmId: 1,
      tags: { highway: 'primary' },
      geometry: { type: 'LineString', coordinates: [[13.003, 51.006], [13.004, 51.006]] },
    } }]) },
  );
  await assert.rejects(buildStreetEngineV3CachePack(rows), /cache_road_conflict/);
});
