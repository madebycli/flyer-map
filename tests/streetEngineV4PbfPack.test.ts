import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStreetEngineV4PbfPack,
  normalizeStreetEngineV4PbfFeatures,
  parseStreetEngineV4GeoJsonSeq,
  type StreetEngineV4PbfFeature,
} from '../worker/streetNetwork/v4PbfPackBuilder.ts';

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

  assert.equal(built.manifest.algorithmVersion, 'v4-pbf-builder-2');
  assert.equal(totals.roads, 1);
  assert.equal(totals.buildings, 3);
  assert.equal(totals.addressableBuildings, 3);
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
