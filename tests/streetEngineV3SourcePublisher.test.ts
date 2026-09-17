import assert from 'node:assert/strict';
import test from 'node:test';
import {
  streetEngineV3SourceManifestHash,
  type StreetEngineV3SourceManifest,
} from '../src/domain/streetEngineV3SourcePack.ts';
import {
  encodeStreetEngineV3Shard,
  resolveStreetEngineV3Manifest,
  streetEngineV3PointerKey,
  type StreetEngineV3Bucket,
  type StreetEngineV3Object,
} from '../worker/streetNetwork/v3SourceRuntime.ts';
import { publishStreetEngineV3SourcePack } from '../worker/streetNetwork/v3SourcePublisher.ts';

class MemoryObject implements StreetEngineV3Object {
  constructor(private readonly bytes: Uint8Array) {}
  async arrayBuffer() { return this.bytes.slice().buffer; }
  async text() { return new TextDecoder().decode(this.bytes); }
}

class MemoryBucket implements StreetEngineV3Bucket {
  readonly values = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
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
    this.writes.push(key);
  }
}

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
    coverageId: 'beta-publisher-test',
    sourcePackVersion: '2026-09-17t120000z',
    algorithmVersion: 'v3-source-1',
    source: {
      dataset: 'OpenStreetMap',
      provider: 'authorized-fixture',
      timestamp: '2026-09-17T12:00:00Z',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
    },
    coverageBounds: [payload.bounds],
    shards: [{
      id: encoded.id,
      bounds: payload.bounds,
      compressedBytes: encoded.bytes.byteLength,
      uncompressedBytes: encoded.uncompressedBytes,
      counts: { roads: 1, buildings: 1, addressableBuildings: 1, roadCandidates: 1 },
    }],
  };
  return { encoded, manifest };
}

test('V3 source publisher verifies immutable objects and moves the channel pointer last', async () => {
  const bucket = new MemoryBucket();
  const { encoded, manifest } = await fixture();
  const result = await publishStreetEngineV3SourcePack({
    bucket,
    channel: 'beta',
    manifest,
    shardObjects: new Map([[encoded.id, encoded.bytes]]),
  });
  assert.equal(result.manifestHash, await streetEngineV3SourceManifestHash(manifest));
  assert.equal(result.uploadedShards, 1);
  assert.equal(result.uploadedManifest, true);
  assert.equal(bucket.writes.at(-1), streetEngineV3PointerKey('beta'));
  const resolved = await resolveStreetEngineV3Manifest(bucket, 'beta');
  assert.equal(resolved.manifestHash, result.manifestHash);
});

test('V3 source publisher never flips the pointer when shard verification fails', async () => {
  const bucket = new MemoryBucket();
  const { encoded, manifest } = await fixture();
  const pointerKey = streetEngineV3PointerKey('beta');
  bucket.values.set(pointerKey, new TextEncoder().encode('old-pointer'));
  const corrupt = encoded.bytes.slice();
  corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;

  await assert.rejects(
    publishStreetEngineV3SourcePack({
      bucket,
      channel: 'beta',
      manifest,
      shardObjects: new Map([[encoded.id, corrupt]]),
    }),
    /street_engine_v3_publish_shard_hash_mismatch/,
  );
  assert.equal(new TextDecoder().decode(bucket.values.get(pointerKey)), 'old-pointer');
  assert.equal(bucket.writes.includes(pointerKey), false);
});
