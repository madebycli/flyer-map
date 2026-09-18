import assert from 'node:assert/strict';
import test from 'node:test';
import {
  streetEngineV3SourceObjectKey,
} from '../src/domain/streetEngineV3SourcePack.ts';
import {
  beginAreaTaskPreparation,
} from '../worker/areaTaskPreparation.ts';
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

async function v4Bucket(): Promise<StreetEngineV3Bucket> {
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

test('V4 retry resets an old failed same-generation legacy job before using the current source pack', async (t) => {
  const db = new NetworkD1();
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

  const result = await runStreetEngineV4Preparation(db, retry.run, {
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

test('V4 transient source retry preserves its current attempt budget instead of resetting it', async (t) => {
  const db = new NetworkD1();
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
