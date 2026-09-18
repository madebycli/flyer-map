import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildStreetEngineV4PbfPack,
  parseStreetEngineV4GeoJsonSeqRecord,
  type StreetEngineV4PbfFeature,
} from '../worker/streetNetwork/v4PbfPackBuilder.ts';

const polygon = (west:number, south:number, east:number, north:number) => [[
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
]] as [number, number][][];

async function* fixtureFeatures(): AsyncGenerator<StreetEngineV4PbfFeature> {
  yield {
    type: 'Feature',
    properties: { '@type': 'way', '@id': 1, highway: 'residential', name: 'Streamstraße' },
    geometry: { type: 'LineString', coordinates: [[7.0, 50.7], [7.008, 50.7]] },
  };
  await Promise.resolve();
  yield {
    type: 'Feature',
    properties: {
      '@type': 'relation',
      '@id': 2,
      building: 'yes',
      'addr:street': 'Streamstraße',
      'addr:housenumber': '8',
    },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [polygon(7.001, 50.7002, 7.0015, 50.7007)],
    },
  };
}

test('V4 pack builder consumes an async feature stream without materializing the source text', async () => {
  const built = await buildStreetEngineV4PbfPack({
    features: fixtureFeatures(),
    coverageBounds: [7.0, 50.7, 7.009, 50.709],
    sourceTimestamp: '2026-09-18T00:00:00Z',
    provider: 'stream-fixture',
  });
  const counts = built.manifest.shards.reduce((totals, shard) => ({
    roads: totals.roads + shard.counts.roads,
    buildings: totals.buildings + shard.counts.buildings,
    addressableBuildings: totals.addressableBuildings + shard.counts.addressableBuildings,
  }), { roads: 0, buildings: 0, addressableBuildings: 0 });
  assert.deepEqual(counts, { roads: 1, buildings: 1, addressableBuildings: 1 });
  assert.equal(built.manifest.algorithmVersion, 'v4-pbf-builder-4');
});

test('V4 GeoJSONSeq record parser accepts record separators one line at a time', () => {
  const raw = '\u001e' + JSON.stringify({
    type: 'Feature',
    properties: { '@type': 'node', '@id': 5, 'addr:housenumber': '10' },
    geometry: { type: 'Point', coordinates: [7.0, 50.7] },
  });
  const feature = parseStreetEngineV4GeoJsonSeqRecord(raw);
  assert.equal(feature?.properties['@id'], 5);
  assert.equal(parseStreetEngineV4GeoJsonSeqRecord('   '), null);
});

test('release V4 pack CLI streams GeoJSONSeq instead of readFile utf8 on the whole export', async () => {
  const source = await readFile('scripts/build-street-engine-v4-pbf-pack.ts', 'utf8');
  assert.match(source, /createReadStream/u);
  assert.match(source, /createInterface/u);
  assert.match(source, /for await \(const rawLine of lines\)/u);
  assert.match(source, /parseStreetEngineV4GeoJsonSeqRecord/u);
  assert.doesNotMatch(source, /readFile\([^\n]*utf8/u);
});
