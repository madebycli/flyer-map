import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStreetEngineV4PbfPack,
  encodeStreetEngineV4Shard,
  normalizeStreetEngineV4PbfFeatures,
  parseStreetEngineV4GeoJsonSeq,
  type StreetEngineV4PbfFeature,
} from '../worker/streetNetwork/v4PbfPackBuilder.ts';
import {
  loadStreetEngineV3Source,
  streetEngineV3ManifestObjectKey,
  streetEngineV3PointerKey,
  type StreetEngineV3Bucket,
  type StreetEngineV3Object,
} from '../worker/streetNetwork/v3SourceRuntime.ts';
import { streetEngineV3SourceObjectKey } from '../src/domain/streetEngineV3SourcePack.ts';

const polygon = (west:number, south:number, east:number, north:number) => [[
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
]] as [number, number][][];

test('V4 GeoJSONSeq parser preserves MultiPolygon buildings from osmium export', () => {
  const raw = [
    JSON.stringify({
      type: 'Feature',
      properties: { '@type': 'relation', '@id': 7, building: 'yes', 'addr:housenumber': '10' },
      geometry: { type: 'MultiPolygon', coordinates: [polygon(7.0, 50.7, 7.001, 50.701), polygon(7.002, 50.7, 7.003, 50.701)] },
    }),
  ].join('\n');
  const parsed = parseStreetEngineV4GeoJsonSeq(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.geometry.type, 'MultiPolygon');
});

test('V4 normalizer decomposes relation MultiPolygon buildings deterministically and retains source identity', () => {
  const features: StreetEngineV4PbfFeature[] = [
    {
      type: 'Feature',
      properties: { '@type': 'node', '@id': 100, 'addr:housenumber': '12' },
      geometry: { type: 'Point', coordinates: [7.0005, 50.7005] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'relation', '@id': 9, building: 'yes' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [polygon(7.0, 50.7, 7.001, 50.701), polygon(7.002, 50.7, 7.003, 50.701)],
      },
    },
  ];
  const normalized = normalizeStreetEngineV4PbfFeatures(features);
  const buildings = normalized.filter((feature) => feature.geometry.type === 'Polygon');
  assert.equal(buildings.length, 2);
  const ids = buildings.map((feature) => feature.properties['@id']) as number[];
  assert.equal(ids.length, 2);
  assert.equal(ids[1] - ids[0], 1);
  assert.ok(ids[0] > 6_000_000_000_000_000);
  const withUnrelatedHighId = normalizeStreetEngineV4PbfFeatures([
    ...features,
    { type: 'Feature', properties: { '@type': 'node', '@id': 999_999 }, geometry: { type: 'Point', coordinates: [7.1, 50.8] } },
  ]).filter((feature) => feature.geometry.type === 'Polygon');
  assert.deepEqual(withUnrelatedHighId.map((feature) => feature.properties['@id']), ids);
  assert.deepEqual(buildings.map((feature) => feature.properties['v4:source_type']), ['relation', 'relation']);
  assert.deepEqual(buildings.map((feature) => feature.properties['v4:source_id']), ['9', '9']);
});

test('V4 pack builder counts Polygon and MultiPolygon buildings instead of silently dropping them', async () => {
  const features: StreetEngineV4PbfFeature[] = [
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 1, highway: 'residential', name: 'Teststraße' },
      geometry: { type: 'LineString', coordinates: [[7.0, 50.7], [7.01, 50.7]] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 2, building: 'yes', 'addr:housenumber': '12', 'addr:street': 'Teststraße' },
      geometry: { type: 'Polygon', coordinates: polygon(7.0002, 50.7002, 7.0008, 50.7008) },
    },
    {
      type: 'Feature',
      properties: { '@type': 'relation', '@id': 3, building: 'yes', 'addr:housenumber': '14', 'addr:street': 'Teststraße' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [polygon(7.0012, 50.7002, 7.0018, 50.7008), polygon(7.0022, 50.7002, 7.0028, 50.7008)],
      },
    },
  ];

  const built = await buildStreetEngineV4PbfPack({
    features,
    coverageBounds: [7.0, 50.7, 7.009, 50.709],
    sourceTimestamp: '2026-09-18T00:00:00Z',
    provider: 'fixture',
  });

  const totals = built.manifest.shards.reduce((counts, shard) => ({
    roads: counts.roads + shard.counts.roads,
    buildings: counts.buildings + shard.counts.buildings,
    addressableBuildings: counts.addressableBuildings + shard.counts.addressableBuildings,
  }), { roads: 0, buildings: 0, addressableBuildings: 0 });

  assert.equal(built.manifest.algorithmVersion, 'v4-pbf-builder-4');
  assert.equal(totals.roads, 1);
  assert.equal(totals.buildings, 3);
  assert.equal(totals.addressableBuildings, 2);
});

test('V4 parser fails closed when a building uses an unsupported geometry', () => {
  const raw = JSON.stringify({
    type: 'Feature',
    properties: { '@type': 'relation', '@id': 9, building: 'yes' },
    geometry: { type: 'GeometryCollection', geometries: [] },
  });
  assert.throws(
    () => parseStreetEngineV4GeoJsonSeq(raw),
    /street_engine_v4_pbf_building_geometry_unsupported/u,
  );
});


function deterministicNoise(seed: number, length: number) {
  let state = seed >>> 0;
  let value = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    value += (state % 36).toString(36);
  }
  return value;
}

test('V4 shard encoder drains CompressionStream while release-sized output applies backpressure', { timeout: 10_000 }, async () => {
  const buildings = Array.from({ length: 1_500 }, (_, index) => {
    const x = 7.0001 + (index % 50) * 0.0001;
    const y = 50.7001 + (Math.floor(index / 50) % 50) * 0.0001;
    return {
      osmId: 10_000 + index,
      tags: {
        building: 'yes',
        name: deterministicNoise(index + 1, 800),
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: polygon(x, y, x + 0.00005, y + 0.00005),
      },
    };
  });
  const encoded = await encodeStreetEngineV4Shard({
    schemaVersion: 1,
    bounds: [7.0, 50.7, 7.009, 50.709],
    roads: [],
    buildings,
    addressNodes: [],
  });
  assert.ok(encoded.uncompressedBytes > 1_000_000);
  assert.ok(encoded.bytes.byteLength > 0);
  assert.match(encoded.id, /^[0-9a-f]{64}$/u);
});


function sourceObject(value: string | Uint8Array): StreetEngineV3Object {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return {
    async arrayBuffer() {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
    async text() {
      return typeof value === 'string' ? value : new TextDecoder().decode(value);
    },
  };
}

test('V4 runtime drains large shard decompression while output applies backpressure', { timeout: 10_000 }, async () => {
  const features: StreetEngineV4PbfFeature[] = Array.from({ length: 1_500 }, (_, index) => {
    const x = 7.0001 + (index % 50) * 0.0001;
    const y = 50.7001 + (Math.floor(index / 50) % 30) * 0.0001;
    return {
      type: 'Feature',
      properties: {
        '@type': 'way',
        '@id': 50_000 + index,
        building: 'yes',
        name: deterministicNoise(index + 10_000, 800),
      },
      geometry: {
        type: 'Polygon',
        coordinates: polygon(x, y, x + 0.00005, y + 0.00005),
      },
    };
  });
  const built = await buildStreetEngineV4PbfPack({
    features,
    coverageBounds: [7.0, 50.7, 7.009, 50.709],
    sourceTimestamp: '2026-09-18T00:00:00Z',
    provider: 'fixture',
  });
  assert.equal(built.shardObjects.size, 1);
  const shard = built.manifest.shards[0]!;
  assert.ok(shard.uncompressedBytes > 1_000_000);

  const objects = new Map<string, StreetEngineV3Object>([
    [streetEngineV3PointerKey('beta'), sourceObject(JSON.stringify({
      schemaVersion: 1,
      channel: 'beta',
      manifestHash: built.manifestHash,
    }))],
    [streetEngineV3ManifestObjectKey(built.manifestHash), sourceObject(built.manifestJson)],
  ]);
  for (const [id, bytes] of built.shardObjects) {
    objects.set(streetEngineV3SourceObjectKey(id), sourceObject(bytes));
  }
  const bucket: StreetEngineV3Bucket = {
    async get(key) {
      return objects.get(key) ?? null;
    },
  };

  const loaded = await loadStreetEngineV3Source({
    bucket,
    channel: 'beta',
    area: {
      type: 'Polygon',
      coordinates: [[[7.0, 50.7], [7.009, 50.7], [7.009, 50.709], [7.0, 50.709], [7.0, 50.7]]],
    },
  });
  assert.equal(loaded.buildings.length, 1_500);
  assert.equal(loaded.diagnostics.shardCount, 1);
  assert.equal(loaded.diagnostics.decodedBytes, shard.uncompressedBytes);
});
