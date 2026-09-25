import assert from 'node:assert/strict';
import test from 'node:test';
import {
  streetEngineV3SourceObjectKey,
} from '../src/domain/streetEngineV3SourcePack.ts';
import {
  beginAreaTaskPreparation,
} from '../worker/areaTaskPreparation.ts';
import { requestDatabase } from '../worker/requestDatabase.ts';
import {
  buildStreetEngineV4PbfPack,
  type StreetEngineV4PbfFeature,
} from '../worker/streetNetwork/v4PbfPackBuilder.ts';
import { runStreetEngineV4Preparation } from '../worker/streetNetwork/v4Preparation.ts';
import {
  streetEngineV3ManifestObjectKey,
  streetEngineV3PointerKey,
  type StreetEngineV3Bucket,
  type StreetEngineV3Object,
} from '../worker/streetNetwork/v3SourceRuntime.ts';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';

async function finishStagedPreparation(
  db: NetworkD1,
  run: Parameters<typeof runStreetEngineV4Preparation>[1],
  options: Parameters<typeof runStreetEngineV4Preparation>[2],
) {
  for (let step = 0; step < 180; step++) {
    const result = await runStreetEngineV4Preparation(db, run, options);
    if (result.outcome !== 'pending') return result;
    const preparation = db.sqlite.prepare(`SELECT status FROM area_task_preparations
      WHERE campaign_id=? AND area_id=?`).get(run.campaignId, run.areaId) as { status: string };
    assert.equal(preparation.status, 'pending', `step ${step} published before completion`);
  }
  assert.fail('V4 staged preparation did not terminate within 180 steps');
}

function object(value: string | Uint8Array): StreetEngineV3Object {
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

async function v4Bucket(extraFeatures: StreetEngineV4PbfFeature[] = []): Promise<StreetEngineV3Bucket> {
  const features: StreetEngineV4PbfFeature[] = [
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 10, highway: 'residential', name: 'Straße' },
      geometry: { type: 'LineString', coordinates: [[13.001, 51.005], [13.009, 51.005]] },
    },
    {
      type: 'Feature',
      properties: {
        '@type': 'way',
        '@id': 20,
        building: 'yes',
        'addr:street': 'Straße',
        'addr:housenumber': '7',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [13.003, 51.0051],
          [13.0032, 51.0051],
          [13.0032, 51.0053],
          [13.003, 51.0053],
          [13.003, 51.0051],
        ]],
      },
    },
    ...extraFeatures,
  ];
  const pack = await buildStreetEngineV4PbfPack({
    features,
    coverageBounds: [13, 51, 13.01, 51.01],
    sourceTimestamp: '2026-09-18T11:00:00Z',
    provider: 'fixture',
  });
  const entries = new Map<string, StreetEngineV3Object>();
  entries.set(
    streetEngineV3PointerKey('beta'),
    object(JSON.stringify({ schemaVersion: 1, channel: 'beta', manifestHash: pack.manifestHash })),
  );
  entries.set(streetEngineV3ManifestObjectKey(pack.manifestHash), object(pack.manifestJson));
  for (const [id, bytes] of pack.shardObjects) {
    entries.set(streetEngineV3SourceObjectKey(id), object(bytes));
  }
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
  };
}

test('V4 alarm completes a road-rich shard inside the 50-query D1 invocation budget', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n');
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;

  const roads: StreetEngineV4PbfFeature[] = Array.from({ length: 200 }, (_, index) => {
    const y = 51.001 + index * 0.00002;
    return {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 10_000 + index, highway: 'residential', name: `Straße ${index}` },
      geometry: { type: 'LineString', coordinates: [[13.001, y], [13.009, y]] },
    };
  });
  const bucket = await v4Bucket(roads);
  let outcome: Awaited<ReturnType<typeof runStreetEngineV4Preparation>> = { outcome: 'pending' };
  for (let alarm = 0; alarm < 400; alarm++) {
    // Fresh wrapper per alarm mirrors PreparationRunner's Free D1 limit.
    outcome = await runStreetEngineV4Preparation(requestDatabase(db, 50), begun.run, {
      streetEngineVersion: 'v4', streetEngineV4Bucket: bucket, streetEngineV4Channel: 'beta',
    });
    if (outcome.outcome !== 'pending') break;
  }
  const job = db.sqlite.prepare('SELECT phase,error_code,attempts FROM street_network_jobs').get();
  assert.equal(outcome.outcome, 'ready', JSON.stringify({ outcome, job }));
  assert.equal((job as { attempts: number }).attempts, 0);
});

test('V4 retry resets an old failed same-generation legacy job before using the current source pack', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const first = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => '67075774-bed4-4e0e-a9eb-1f3bd9b9dc26',
    now: () => new Date('2026-09-18T05:57:00Z'),
  });
  assert.equal(first.outcome, 'run');
  if (first.outcome !== 'run') return;

  db.sqlite.prepare(`INSERT INTO street_network_jobs(
    campaign_id,area_id,generation,geometry_json,phase,cursor,lease,lease_until,attempts,error_code,metrics_json
  ) VALUES(?,?,?,?, 'roads',0,NULL,?,5,'network_preparation_failure','{}')`).run(
    first.run.campaignId,
    first.run.areaId,
    first.run.generation,
    JSON.stringify(first.run.area.geometry),
    '2026-09-18T05:58:00Z',
  );
  db.sqlite.prepare(`UPDATE area_task_preparations
    SET status='failed',failed_at=?,updated_at=?,last_error_code='area_preparation_osm_failed'
    WHERE campaign_id=? AND area_id=?`).run(
    '2026-09-18T05:57:45Z',
    '2026-09-18T05:57:45Z',
    first.run.campaignId,
    first.run.areaId,
  );

  const retry = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    now: () => new Date('2026-09-18T12:00:00Z'),
  });
  assert.equal(retry.outcome, 'run');
  if (retry.outcome !== 'run') return;
  assert.equal(retry.run.generation, first.run.generation);
  const restarted = db.sqlite.prepare(`SELECT status,started_at,failed_at,last_error_code
    FROM area_task_preparations WHERE campaign_id='campaign_n' AND area_id='area_n'`).get() as {
      status: string;
      started_at: string | null;
      failed_at: string | null;
      last_error_code: string | null;
    };
  assert.equal(restarted.status, 'pending');
  assert.equal(restarted.started_at, '2026-09-18T12:00:00.000Z');
  assert.equal(restarted.failed_at, null);
  assert.equal(restarted.last_error_code, null);

  const result = await finishStagedPreparation(db, retry.run, {
    streetEngineVersion: 'v4',
    streetEngineV4Bucket: await v4Bucket(),
    streetEngineV4Channel: 'beta',
    now: () => new Date('2026-09-18T12:00:01Z'),
  });
  const diagnosticJob = db.sqlite.prepare(`SELECT phase,attempts,error_code,metrics_json
    FROM street_network_jobs WHERE campaign_id='campaign_n' AND area_id='area_n'`).get() as {
      phase: string;
      attempts: number;
      error_code: string | null;
      metrics_json: string;
    };
  assert.equal(result.outcome, 'ready', JSON.stringify({
    result,
    phase: diagnosticJob.phase,
    attempts: diagnosticJob.attempts,
    errorCode: diagnosticJob.error_code,
    metrics: JSON.parse(diagnosticJob.metrics_json),
  }));

  const job = db.sqlite.prepare(`SELECT phase,cursor,attempts,error_code,lease,lease_until,metrics_json
    FROM street_network_jobs WHERE campaign_id='campaign_n' AND area_id='area_n'`).get() as {
      phase: string;
      cursor: number;
      attempts: number;
      error_code: string | null;
      lease: string | null;
      lease_until: string | null;
      metrics_json: string;
    };
  const metrics = JSON.parse(job.metrics_json) as Record<string, unknown>;
  assert.equal(job.phase, 'ready');
  assert.equal(job.cursor, 0);
  assert.equal(job.attempts, 0);
  assert.equal(job.error_code, null);
  assert.equal(job.lease, null);
  assert.equal(job.lease_until, null);
  assert.equal(metrics.engineVersion, 'v4');
  assert.equal(metrics.legacyOverpassRequests, 0);
  assert.equal(metrics.algorithmVersion, 'v4-pbf-builder-4');
  assert.match(String(metrics.manifestHash), /^[0-9a-f]{64}$/u);
  assert.equal(metrics.roads, 1);
  assert.equal(metrics.buildings, 1);
  assert.equal(metrics.addressableBuildings, 1);
  assert.equal(metrics.houses, 1);

  const preparation = db.sqlite.prepare(`SELECT status,road_count,house_count,last_error_code,failed_at,ready_at
    FROM area_task_preparations WHERE campaign_id='campaign_n' AND area_id='area_n'`).get() as {
      status: string;
      road_count: number;
      house_count: number;
      last_error_code: string | null;
      failed_at: string | null;
      ready_at: string | null;
    };
  assert.deepEqual({
    status: preparation.status,
    road_count: preparation.road_count,
    house_count: preparation.house_count,
    last_error_code: preparation.last_error_code,
    failed_at: preparation.failed_at,
  }, {
    status: 'ready',
    road_count: 1,
    house_count: 1,
    last_error_code: null,
    failed_at: null,
  });
  assert.equal(preparation.ready_at, '2026-09-18T12:00:01.000Z');
});

test('V4 retry after runner failure drops the old pinned manifest and partial shard rows', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  const first = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    now: () => new Date('2026-09-24T11:33:13Z'),
  });
  assert.equal(first.outcome, 'run');
  if (first.outcome !== 'run') return;
  const firstBucket = await v4Bucket();
  const options = { streetEngineVersion: 'v4' as const, streetEngineV4Channel: 'beta', streetEngineV4Bucket: firstBucket };
  await runStreetEngineV4Preparation(db, first.run, options); // plan
  await runStreetEngineV4Preparation(db, first.run, options); // source shard
  const oldJob = db.sqlite.prepare('SELECT phase,cursor,metrics_json FROM street_network_jobs').get() as {
    phase: string; cursor: number; metrics_json: string;
  };
  assert.equal(oldJob.phase, 'v4-node-usage');
  assert.ok(db.sqlite.prepare("SELECT 1 FROM street_network_staging WHERE kind='v4-fragments'").get());

  // The runner's crash guard fails the preparation without changing the V4
  // job's mid-phase state, as observed on Beta after the first release.
  db.sqlite.prepare(`UPDATE area_task_preparations SET status='failed',
    last_error_code='area_preparation_runner_unavailable',failed_at=?,updated_at=?`).run(
    '2026-09-24T11:39:44Z', '2026-09-24T11:39:44Z',
  );
  const retry = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    now: () => new Date('2026-09-25T08:10:56Z'),
  });
  assert.equal(retry.outcome, 'run');
  if (retry.outcome !== 'run') return;
  assert.equal(retry.run.generation, first.run.generation);

  const newerBucket = await v4Bucket([{
    type: 'Feature',
    properties: { '@type': 'way', '@id': 11, highway: 'residential', name: 'Neue Straße' },
    geometry: { type: 'LineString', coordinates: [[13.002, 51.006], [13.008, 51.006]] },
  }]);
  const newerPointer = await newerBucket.get(streetEngineV3PointerKey('beta'));
  assert.ok(newerPointer);
  const newHash = (JSON.parse(await newerPointer!.text()) as { manifestHash: string }).manifestHash;
  assert.notEqual(newHash, (JSON.parse(oldJob.metrics_json) as { manifestHash: string }).manifestHash);

  const step = await runStreetEngineV4Preparation(db, retry.run, {
    ...options, streetEngineV4Bucket: newerBucket,
  });
  assert.equal(step.outcome, 'pending');
  const job = db.sqlite.prepare('SELECT phase,cursor,attempts,metrics_json FROM street_network_jobs').get() as {
    phase: string; cursor: number; attempts: number; metrics_json: string;
  };
  assert.equal(job.phase, 'v4-source');
  assert.equal(job.cursor, 0);
  assert.equal(job.attempts, 0);
  assert.equal((JSON.parse(job.metrics_json) as { manifestHash: string }).manifestHash, newHash);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM street_network_staging WHERE kind='v4-fragments'").get()!.count, 0);

  const finished = await finishStagedPreparation(db, retry.run, {
    ...options, streetEngineV4Bucket: newerBucket,
  });
  assert.equal(finished.outcome, 'ready');
});


test('V4 budgets apply to generated product entities instead of raw shard source counts', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    now: () => new Date('2026-09-18T13:00:00Z'),
  });
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;

  const rawOnlyFeatures: StreetEngineV4PbfFeature[] = [
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 11, highway: 'motorway', name: 'Nicht verteilbar' },
      geometry: { type: 'LineString', coordinates: [[13.001, 51.006], [13.009, 51.006]] },
    },
    {
      type: 'Feature',
      properties: { '@type': 'way', '@id': 21, building: 'yes' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [13.004, 51.0061],
          [13.0042, 51.0061],
          [13.0042, 51.0063],
          [13.004, 51.0063],
          [13.004, 51.0061],
        ]],
      },
    },
  ];

  const result = await finishStagedPreparation(db, begun.run, {
    streetEngineVersion: 'v4',
    streetEngineV4Bucket: await v4Bucket(rawOnlyFeatures),
    streetEngineV4Channel: 'beta',
    maxRoadFragments: 1,
    maxBuildings: 1,
    now: () => new Date('2026-09-18T13:00:01Z'),
  });

  assert.equal(result.outcome, 'ready');
  const job = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(job.metrics_json) as Record<string, unknown>;
  assert.equal(metrics.sourceRoads, 2);
  assert.equal(metrics.graphCandidateRoads, 1);
  assert.equal(metrics.roads, 1);
  assert.equal(metrics.sourceBuildings, 2);
  assert.equal(metrics.addressableBuildings, 1);
  assert.equal(metrics.houses, 1);
});


test('V4 house budget ignores addressable shard buildings outside the Area', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  db.sqlite.prepare("UPDATE areas SET geometry_json=? WHERE id='area_n'").run(JSON.stringify({
    type: 'Polygon',
    coordinates: [[[13, 51], [13.008, 51], [13.008, 51.008], [13, 51.008], [13, 51]]],
  }));

  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    now: () => new Date('2026-09-18T13:05:00Z'),
  });
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;

  const outsideAddressedBuilding: StreetEngineV4PbfFeature = {
    type: 'Feature',
    properties: {
      '@type': 'way',
      '@id': 22,
      building: 'yes',
      'addr:street': 'Außerhalb',
      'addr:housenumber': '99',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [13.009, 51.009],
        [13.0092, 51.009],
        [13.0092, 51.0092],
        [13.009, 51.0092],
        [13.009, 51.009],
      ]],
    },
  };

  const result = await finishStagedPreparation(db, begun.run, {
    streetEngineVersion: 'v4',
    streetEngineV4Bucket: await v4Bucket([outsideAddressedBuilding]),
    streetEngineV4Channel: 'beta',
    maxBuildings: 1,
    now: () => new Date('2026-09-18T13:05:01Z'),
  });

  assert.equal(result.outcome, 'ready');
  const job = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(job.metrics_json) as Record<string, unknown>;
  assert.equal(metrics.sourceBuildings, 2);
  assert.equal(metrics.addressableBuildings, 2);
  assert.equal(metrics.areaAddressableBuildings, 1);
  assert.equal(metrics.houses, 1);
});

test('V4 still fails closed when generated road fragments exceed the product limit', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    now: () => new Date('2026-09-18T13:10:00Z'),
  });
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;

  const result = await finishStagedPreparation(db, begun.run, {
    streetEngineVersion: 'v4',
    streetEngineV4Bucket: await v4Bucket(),
    streetEngineV4Channel: 'beta',
    maxRoadFragments: 0,
    now: () => new Date('2026-09-18T13:10:01Z'),
  });

  assert.equal(result.outcome, 'failed');
  const job = db.sqlite.prepare('SELECT error_code FROM street_network_jobs').get() as { error_code: string };
  assert.equal(job.error_code, 'street_engine_v4_graph_build_budget');
});

test('V4 transient source retry preserves its current attempt budget instead of resetting it', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    now: () => new Date('2026-09-18T12:00:00Z'),
  });
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;

  const healthyBucket = await v4Bucket();
  const pointerObject = await healthyBucket.get(streetEngineV3PointerKey('beta'));
  assert.ok(pointerObject);
  const pointer = JSON.parse(await pointerObject!.text()) as { manifestHash: string };
  const transientBucket: StreetEngineV3Bucket = {
    async get(key) {
      if (key.endsWith('.bin')) throw new Error('street_engine_v3_source_unavailable');
      return healthyBucket.get(key);
    },
  };
  db.sqlite.prepare(`INSERT INTO street_network_jobs(
    campaign_id,area_id,generation,geometry_json,phase,cursor,lease,lease_until,attempts,error_code,metrics_json
  ) VALUES(?,?,?,?, 'v4-source',0,NULL,NULL,1,'street_engine_v4_source_unavailable',?)`).run(
    begun.run.campaignId,
    begun.run.areaId,
    begun.run.generation,
    JSON.stringify(begun.run.area.geometry),
    JSON.stringify({
      engineVersion: 'v4',
      legacyOverpassRequests: 0,
      manifestHash: pointer.manifestHash,
      taskTimestamp: '2026-09-18T12:00:00.000Z',
    }),
  );

  const result = await runStreetEngineV4Preparation(db, begun.run, {
    streetEngineVersion: 'v4',
    streetEngineV4Bucket: transientBucket,
    streetEngineV4Channel: 'beta',
    now: () => new Date('2026-09-18T12:00:01Z'),
  });
  assert.equal(result.outcome, 'pending');
  const job = db.sqlite.prepare('SELECT attempts,phase,metrics_json FROM street_network_jobs').get() as {
    attempts: number;
    phase: string;
    metrics_json: string;
  };
  assert.equal(job.attempts, 2);
  assert.equal(job.phase, 'v4-source');
  assert.equal((JSON.parse(job.metrics_json) as { engineVersion: string }).engineVersion, 'v4');
});

test('V4 staged result and task timestamps are independent of alarm timing', async (t) => {
  const source = await v4Bucket();
  const results: { hash: string; payloads: string[]; taskTimestamp: string }[] = [];
  for (const variableClock of [false, true]) {
    const db = new NetworkD1(true);
    t.after(() => db.sqlite.close());
    seedNetwork(db);
    const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
      randomUUID: () => '99999999-9999-4999-8999-999999999999',
      now: () => new Date('2026-09-18T14:00:00Z'),
    });
    assert.equal(begun.outcome, 'run');
    if (begun.outcome !== 'run') return;
    let tick = 0;
    const result = await finishStagedPreparation(db, begun.run, {
      streetEngineVersion: 'v4',
      streetEngineV4Bucket: source,
      streetEngineV4Channel: 'beta',
      v4LinkBuckets: variableClock ? 2 : 1,
      now: () => new Date(Date.parse('2026-09-18T14:00:01Z') + (variableClock ? tick++ * 1_000 : 0)),
    });
    assert.equal(result.outcome, 'ready');
    const row = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
    const metrics = JSON.parse(row.metrics_json) as { resultHash: string; taskTimestamp: string };
    const payloads = db.sqlite.prepare('SELECT payload_json FROM street_base_chunks ORDER BY content_hash')
      .all().map((item) => item.payload_json as string);
    results.push({ hash: metrics.resultHash, taskTimestamp: metrics.taskTimestamp, payloads });
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].taskTimestamp, '2026-09-18T14:00:00.000Z');
});

test('V4 address keys are deduplicated across source shards before the House budget', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  db.sqlite.prepare("UPDATE areas SET geometry_json=? WHERE id='area_n'").run(JSON.stringify({
    type: 'Polygon', coordinates: [[[13, 51], [13.02, 51], [13.02, 51.01], [13, 51.01], [13, 51]]],
  }));
  const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    randomUUID: () => '88888888-8888-4888-8888-888888888888',
    now: () => new Date('2026-09-18T15:00:00Z'),
  });
  assert.equal(begun.outcome, 'run');
  if (begun.outcome !== 'run') return;
  const duplicate = {
    type: 'Feature' as const,
    properties: { '@type': 'way', '@id': 21, building: 'yes', 'addr:street': 'Straße', 'addr:housenumber': '7' },
    geometry: { type: 'Polygon' as const, coordinates: [[
      [13.011, 51.0051], [13.0112, 51.0051], [13.0112, 51.0053],
      [13.011, 51.0053], [13.011, 51.0051],
    ]] },
  };
  const result = await finishStagedPreparation(db, begun.run, {
    streetEngineVersion: 'v4', streetEngineV4Bucket: await v4Bucket([duplicate]),
    streetEngineV4Channel: 'beta', maxBuildings: 1,
    now: () => new Date('2026-09-18T15:00:01Z'),
  });
  assert.equal(result.outcome, 'ready');
  const row = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(row.metrics_json) as Record<string, unknown>;
  assert.equal(metrics.shardCount, 2);
  assert.equal(metrics.sourceBuildings, 2);
  assert.equal(metrics.addressableBuildings, 1);
  assert.equal(metrics.areaAddressableBuildings, 1);
  assert.equal(metrics.houses, 1);
});
