import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStreetEngineV3PbfPack, type StreetEngineV3PbfFeature } from '../worker/streetNetwork/v3PbfPackBuilder.ts';
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

const features: StreetEngineV3PbfFeature[] = [
  {
    type: 'Feature',
    properties: { '@type': 'way', '@id': 1, highway: 'residential', name: 'Straße' },
    geometry: { type: 'LineString', coordinates: [[13.001, 51.005], [13.009, 51.005]] },
  },
  {
    type: 'Feature',
    properties: { '@type': 'way', '@id': 100, building: 'house', 'addr:street': 'Straße', 'addr:housenumber': '1' },
    geometry: { type: 'Polygon', coordinates: [[[13.002, 51.0051], [13.0022, 51.0051], [13.0022, 51.0053], [13.002, 51.0051]]] },
  },
  {
    type: 'Feature',
    properties: { '@type': 'node', '@id': 200, 'addr:street': 'Straße', 'addr:housenumber': '1' },
    geometry: { type: 'Point', coordinates: [13.0021, 51.0052] },
  },
];

const area = {
  type: 'Polygon',
  coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
} as const;

test('offline PBF builder creates deterministic spatial shards including exact address-node counts', async () => {
  const input = { features, coverageBounds: [13, 51, 13.01, 51.01] as const, sourceTimestamp: '2026-09-17T10:00:00Z' };
  const left = await buildStreetEngineV3PbfPack(input);
  const right = await buildStreetEngineV3PbfPack({ ...input, features: [...features].reverse() });
  assert.equal(left.manifestHash, right.manifestHash);
  assert.equal(left.manifest.source.provider, 'osm-pbf');
  assert.equal(left.manifest.shards.length, 1);
  assert.deepEqual(left.manifest.shards[0].counts, {
    roads: 1,
    buildings: 1,
    addressableBuildings: 1,
    addressNodes: 1,
    roadCandidates: 1,
  });
});

test('offline PBF pack publishes and runs through V3 without any legacy Overpass request', async () => {
  const pack = await buildStreetEngineV3PbfPack({
    features,
    coverageBounds: [13, 51, 13.01, 51.01],
    sourceTimestamp: '2026-09-17T10:00:00Z',
  });
  const bucket = new MemoryBucket();
  await publishStreetEngineV3SourcePack({ bucket, channel: 'beta', manifest: pack.manifest, shardObjects: pack.shardObjects });
  const loaded = await loadStreetEngineV3Source({ bucket, channel: 'beta', area });
  assert.equal(loaded.roads.length, 1);
  assert.equal(loaded.buildings.length, 1);
  assert.equal(loaded.addressNodes.length, 1);
  assert.equal(loaded.diagnostics.engineVersion, 'sourcepack-v3');
  assert.equal(loaded.diagnostics.legacyOverpassRequests, 0);
});

test('offline PBF builder emits empty coverage shards so a covered no-feature cell never falls back to Overpass', async () => {
  const pack = await buildStreetEngineV3PbfPack({
    features: [],
    coverageBounds: [13, 51, 13.02, 51.01],
    sourceTimestamp: '2026-09-17T10:00:00Z',
  });
  assert.equal(pack.manifest.shards.length, 2);
  assert.equal(pack.manifest.shards.every((shard) => shard.counts.roads === 0 && shard.counts.buildings === 0), true);
});
