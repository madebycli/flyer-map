import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalStreetEngineV3SourceManifestJson,
  selectStreetEngineV3SourceShards,
  streetEngineV3SourceManifestHash,
  streetEngineV3SourceObjectKey,
  STREET_ENGINE_V3_MAX_UNCOMPRESSED_SHARD_BYTES,
  validateStreetEngineV3SourceManifest,
  type StreetEngineV3SourceManifest,
} from '../src/domain/streetEngineV3SourcePack.ts';

const MIB = 1024 * 1024;
const hash = (character: string) => character.repeat(64);

function manifest(): StreetEngineV3SourceManifest {
  return {
    schemaVersion: 1,
    format: 'street-engine-v3-binary-shard-v1',
    coverageId: 'coverage-test',
    sourcePackVersion: '2026-09-16t120000z',
    algorithmVersion: 'v3-source-1',
    source: {
      dataset: 'OpenStreetMap',
      provider: 'fixture',
      timestamp: '2026-09-16T12:00:00Z',
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
    },
    coverageBounds: [[10, 50, 12, 52]],
    shards: [
      {
        id: hash('a'),
        bounds: [10, 50, 10.5, 50.5],
        compressedBytes: 4 * MIB,
        uncompressedBytes: 8 * MIB,
        counts: { roads: 100, buildings: 500, addressableBuildings: 300, roadCandidates: 1_200 },
      },
      {
        id: hash('b'),
        bounds: [10.5, 50, 11, 50.5],
        compressedBytes: 5 * MIB,
        uncompressedBytes: 10 * MIB,
        counts: { roads: 120, buildings: 700, addressableBuildings: 420, roadCandidates: 1_600 },
      },
      {
        id: hash('c'),
        bounds: [11.5, 51.5, 12, 52],
        compressedBytes: 6 * MIB,
        uncompressedBytes: 12 * MIB,
        counts: { roads: 130, buildings: 800, addressableBuildings: 500, roadCandidates: 1_900 },
      },
    ],
  };
}

test('Source pack uses digest-derived object keys only', () => {
  assert.equal(
    streetEngineV3SourceObjectKey(hash('a')),
    `source/v1/aa/${hash('a')}.bin`,
  );
  assert.throws(() => streetEngineV3SourceObjectKey('https://example.com/a'), /invalid_hash/);
});

test('Source manifest validates provenance, bounds, counts and immutable shard identity', () => {
  assert.equal(validateStreetEngineV3SourceManifest(manifest()).coverageId, 'coverage-test');

  const duplicate = manifest();
  duplicate.shards[1] = { ...duplicate.shards[1], id: duplicate.shards[0].id };
  assert.throws(() => validateStreetEngineV3SourceManifest(duplicate), /invalid_shard/);

  const invalidCounts = manifest();
  invalidCounts.shards[0] = {
    ...invalidCounts.shards[0],
    counts: { ...invalidCounts.shards[0].counts, addressableBuildings: 501 },
  };
  assert.throws(() => validateStreetEngineV3SourceManifest(invalidCounts), /invalid_shard/);
});



test('Source manifest allows valid gzip expansion for sparse shards', () => {
  const sparse = manifest();
  sparse.shards[0] = {
    ...sparse.shards[0],
    compressedBytes: 1_024,
    uncompressedBytes: 900,
  };
  assert.equal(validateStreetEngineV3SourceManifest(sparse).shards[0].compressedBytes, 1_024);
});

test('Source manifest rejects shards above the decoded-size hard limit', () => {
  const decodedOversize = manifest();
  decodedOversize.shards[0] = {
    ...decodedOversize.shards[0],
    compressedBytes: 10 * MIB,
    uncompressedBytes: STREET_ENGINE_V3_MAX_UNCOMPRESSED_SHARD_BYTES + 1,
  };
  assert.throws(() => validateStreetEngineV3SourceManifest(decodedOversize), /invalid_shard/);
});

test('Canonical manifest and hash are independent from shard and coverage ordering', async () => {
  const left = manifest();
  left.coverageBounds.push([12, 50, 13, 51]);
  const right = manifest();
  right.coverageBounds = [[12, 50, 13, 51], ...right.coverageBounds];
  right.shards.reverse();

  assert.equal(
    canonicalStreetEngineV3SourceManifestJson(left),
    canonicalStreetEngineV3SourceManifestJson(right),
  );
  assert.equal(
    await streetEngineV3SourceManifestHash(left),
    await streetEngineV3SourceManifestHash(right),
  );
});

test('Area selection downloads only intersecting immutable shards and stays under cold budget', async () => {
  const selected = await selectStreetEngineV3SourceShards(manifest(), {
    type: 'Polygon',
    coordinates: [[[10.1, 50.1], [10.9, 50.1], [10.9, 50.4], [10.1, 50.4], [10.1, 50.1]]],
  });

  assert.deepEqual(selected.shards.map((shard) => shard.id), [hash('a'), hash('b')]);
  assert.equal(selected.transfer.downloadBytes, 9 * MIB);
  assert.equal(selected.transfer.status, 'ok');
  assert.match(selected.manifestHash, /^[0-9a-f]{64}$/);
});

test('Area selection hard-blocks a source plan above 40 MiB before object fetch', async () => {
  const large = manifest();
  large.shards[0] = {
    ...large.shards[0],
    compressedBytes: 41 * MIB,
    uncompressedBytes: 50 * MIB,
  };
  large.shards = [large.shards[0]];

  const selected = await selectStreetEngineV3SourceShards(large, {
    type: 'Polygon',
    coordinates: [[[10.1, 50.1], [10.2, 50.1], [10.2, 50.2], [10.1, 50.2], [10.1, 50.1]]],
  });
  assert.equal(selected.transfer.status, 'blocked');
  assert.equal(selected.transfer.downloadBytes, 41 * MIB);
});

test('Area selection supports small polygons crossing the antimeridian without worldwide overfetch', async () => {
  const crossing: StreetEngineV3SourceManifest = {
    ...manifest(),
    coverageBounds: [[179, -1, 180, 1], [-180, -1, -179, 1]],
    shards: [
      { ...manifest().shards[0], id: hash('d'), bounds: [179, -1, 180, 1] },
      { ...manifest().shards[1], id: hash('e'), bounds: [-180, -1, -179, 1] },
      { ...manifest().shards[2], id: hash('f'), bounds: [0, -1, 1, 1] },
    ],
  };

  const selected = await selectStreetEngineV3SourceShards(crossing, {
    type: 'Polygon',
    coordinates: [[[179.5, -0.5], [-179.5, -0.5], [-179.5, 0.5], [179.5, 0.5], [179.5, -0.5]]],
  });
  assert.deepEqual(selected.shards.map((shard) => shard.id), [hash('d'), hash('e')]);
});

test('Area selection fails closed outside declared coverage', async () => {
  await assert.rejects(
    selectStreetEngineV3SourceShards(manifest(), {
      type: 'Polygon',
      coordinates: [[[30, 30], [30.1, 30], [30.1, 30.1], [30, 30.1], [30, 30]]],
    }),
    /outside_coverage/,
  );
});
