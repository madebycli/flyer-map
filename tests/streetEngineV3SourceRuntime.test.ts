import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  streetEngineV3SourceObjectKey,
  type StreetEngineV3SourceManifest,
} from '../src/domain/streetEngineV3SourcePack.ts';
import {
  encodeStreetEngineV3Shard,
  loadStreetEngineV3Source,
  streetEngineV3ManifestObjectKey,
  streetEngineV3PointerKey,
  type StreetEngineV3Bucket,
  type StreetEngineV3Object,
} from '../worker/streetNetwork/v3SourceRuntime.ts';

class MemoryObject implements StreetEngineV3Object {
  constructor(private readonly bytes: Uint8Array) {}
  async arrayBuffer() { return this.bytes.slice().buffer; }
  async text() { return new TextDecoder().decode(this.bytes); }
}

class MemoryBucket implements StreetEngineV3Bucket {
  readonly values = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  async get(key: string) {
    this.gets.push(key);
    const bytes = this.values.get(key);
    return bytes ? new MemoryObject(bytes) : null;
  }
  set(key: string, value: Uint8Array | string) {
    this.values.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value);
  }
}

const area = {
  type: 'Polygon',
  coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
} as const;

async function fixture() {
  const payload = {
    schemaVersion: 1 as const,
    bounds: [13, 51, 13.01, 51.01] as const,
    roads: [{
      osmId: 1,
      tags: { highway: 'residential', name: 'Straße' },
      geometry: { type: 'LineString' as const, coordinates: [[13.001, 51.005], [13.009, 51.005]] as [number, number][] },
    }],
    buildings: [{
      osmId: 100,
      tags: { building: 'house', 'addr:street': 'Straße', 'addr:housenumber': '1' },
      geometry: { type: 'Polygon' as const, coordinates: [[[13.002, 51.0051], [13.0021, 51.0051], [13.0021, 51.0052], [13.002, 51.0051]]] },
    }],
    addressNodes: [],
  };
  const encoded = await encodeStreetEngineV3Shard(payload);
  const manifest: StreetEngineV3SourceManifest = {
    schemaVersion: 1,
    format: 'street-engine-v3-binary-shard-v1',
    coverageId: 'beta-test',
    sourcePackVersion: '2026-09-17t100000z',
    algorithmVersion: 'v3-source-1',
    source: {
      dataset: 'OpenStreetMap',
      provider: 'authorized-fixture',
      timestamp: '2026-09-17T10:00:00Z',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
    },
    coverageBounds: [[13, 51, 13.01, 51.01]],
    shards: [{
      id: encoded.id,
      bounds: payload.bounds,
      compressedBytes: encoded.bytes.byteLength,
      uncompressedBytes: encoded.uncompressedBytes,
      counts: { roads: 1, buildings: 1, addressableBuildings: 1, roadCandidates: 1 },
    }],
  };
  const manifestHash = await streetEngineV3SourceManifestHash(manifest);
  const bucket = new MemoryBucket();
  bucket.set(streetEngineV3PointerKey('beta'), JSON.stringify({ schemaVersion: 1, channel: 'beta', manifestHash }));
  bucket.set(streetEngineV3ManifestObjectKey(manifestHash), canonicalStreetEngineV3SourceManifestJson(manifest));
  bucket.set(streetEngineV3SourceObjectKey(encoded.id), encoded.bytes);
  return { bucket, manifest, manifestHash, encoded };
}

test('V3 runtime reads only immutable source-pack objects and reports zero legacy Overpass requests', async () => {
  const { bucket, manifestHash } = await fixture();
  const loaded = await loadStreetEngineV3Source({ bucket, channel: 'beta', area });
  assert.equal(loaded.manifestHash, manifestHash);
  assert.equal(loaded.roads.length, 1);
  assert.equal(loaded.buildings.length, 1);
  assert.equal(loaded.diagnostics.engineVersion, 'sourcepack-v3');
  assert.equal(loaded.diagnostics.legacyOverpassRequests, 0);
  assert.equal(loaded.diagnostics.objectGets, 3);
  assert.equal(bucket.gets.some((key) => /overpass|https?:/i.test(key)), false);
});

test('V3 runtime rejects corrupted shard bytes before decode or publish', async () => {
  const { bucket, manifest } = await fixture();
  const key = streetEngineV3SourceObjectKey(manifest.shards[0].id);
  const corrupt = bucket.values.get(key)!.slice();
  corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
  bucket.set(key, corrupt);
  await assert.rejects(loadStreetEngineV3Source({ bucket, channel: 'beta', area }), /shard_hash_mismatch/);
});

test('V3 runtime rejects descriptor/payload bounds mismatch', async () => {
  const { bucket, manifest, encoded } = await fixture();
  const mismatched: StreetEngineV3SourceManifest = {
    ...manifest,
    coverageBounds: [[13, 51, 13.009, 51.01]],
    shards: [{ ...manifest.shards[0], bounds: [13, 51, 13.009, 51.01] }],
  };
  const manifestHash = await streetEngineV3SourceManifestHash(mismatched);
  bucket.set(streetEngineV3PointerKey('beta'), JSON.stringify({ schemaVersion: 1, channel: 'beta', manifestHash }));
  bucket.set(streetEngineV3ManifestObjectKey(manifestHash), canonicalStreetEngineV3SourceManifestJson(mismatched));
  bucket.set(streetEngineV3SourceObjectKey(encoded.id), encoded.bytes);
  await assert.rejects(loadStreetEngineV3Source({ bucket, channel: 'beta', area }), /shard_bounds_mismatch/);
});

test('V3 transfer above 40 MiB blocks before any shard object GET', async () => {
  const { bucket, manifest } = await fixture();
  const oversized: StreetEngineV3SourceManifest = {
    ...manifest,
    shards: [{
      ...manifest.shards[0],
      compressedBytes: 41 * 1024 * 1024,
      uncompressedBytes: 42 * 1024 * 1024,
    }],
  };
  const manifestHash = await streetEngineV3SourceManifestHash(oversized);
  bucket.set(streetEngineV3PointerKey('beta'), JSON.stringify({ schemaVersion: 1, channel: 'beta', manifestHash }));
  bucket.set(streetEngineV3ManifestObjectKey(manifestHash), canonicalStreetEngineV3SourceManifestJson(oversized));
  bucket.gets.length = 0;
  await assert.rejects(loadStreetEngineV3Source({ bucket, channel: 'beta', area }), /source_transfer_budget/);
  assert.deepEqual(bucket.gets, [streetEngineV3PointerKey('beta'), streetEngineV3ManifestObjectKey(manifestHash)]);
});

test('Pinned manifest bypasses mutable channel pointer during generation recovery', async () => {
  const { bucket, manifestHash } = await fixture();
  bucket.values.delete(streetEngineV3PointerKey('beta'));
  bucket.gets.length = 0;
  const loaded = await loadStreetEngineV3Source({ bucket, channel: 'beta', area, pinnedManifestHash: manifestHash });
  assert.equal(loaded.manifestHash, manifestHash);
  assert.equal(bucket.gets[0], streetEngineV3ManifestObjectKey(manifestHash));
  assert.equal(bucket.gets.includes(streetEngineV3PointerKey('beta')), false);
});
