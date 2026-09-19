import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginAreaTaskPreparation,
  prepareAreaTasks,
  runAreaTaskPreparation,
  type AreaTaskPreparationOptions,
} from '../worker/areaTaskPreparation.ts';
import { preparationTiles } from '../worker/streetNetwork/preparation.ts';
import { BudgetD1 } from './helpers/d1Budget.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

const STAMP = '2026-09-16T07:00:00.000Z';
const PRIMARY = 'https://overpass.private.coffee/api/interpreter';
const FALLBACK = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const INVALID_POLYGON_IDS = [172893336, 172893352, 172942735] as const;
const BENCHMARK_GEOMETRY = {
  type: 'Polygon' as const,
  coordinates: [[[13, 51], [13.02, 51], [13.02, 51.02], [13, 51.02], [13, 51]]],
};

type Fixture = {
  roadTiles: unknown[][];
  buildingTiles: unknown[][];
};

type PipelineSample = {
  totalMs: number;
  steps: number;
  nominalAlarmWaitMs: number;
  phaseWallMs: Record<string, number>;
  metrics: Record<string, any>;
  externalCalls: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFixture(): Fixture {
  const rawByTile = [677, 677, 677, 676];
  const roadTiles: unknown[][] = Array.from({ length: 4 }, () => []);
  const buildingTiles: unknown[][] = Array.from({ length: 4 }, () => []);
  let validIndex = 0;
  let rawIndex = 0;

  for (let tile = 0; tile < 4; tile += 1) {
    const tileX = tile % 2;
    const tileY = Math.floor(tile / 2);
    const west = 13 + tileX * 0.01;
    const south = 51 + tileY * 0.01;

    for (let road = 0; road < 5; road += 1) {
      const x = west + 0.001 + road * 0.0018;
      roadTiles[tile].push({
        type: 'way',
        id: 10_000 + tile * 10 + road,
        tags: { highway: 'residential', name: `Road ${tile}-${road}` },
        geometry: [{ lon: x, lat: south + 0.0001 }, { lon: x, lat: south + 0.0099 }],
      });
    }

    for (let local = 0; local < rawByTile[tile]; local += 1, rawIndex += 1) {
      const x = west + 0.00015 + (local % 26) * 0.00036;
      const y = south + 0.00015 + Math.floor(local / 26) * 0.00036;
      const size = 0.00008;
      const invalidId = rawIndex < INVALID_POLYGON_IDS.length ? INVALID_POLYGON_IDS[rawIndex] : null;
      const id = invalidId ?? 200_000_000 + validIndex;
      const addressable = invalidId === null && validIndex < 602;
      const tags: Record<string, string> = { building: 'house' };
      if (addressable) {
        tags['addr:street'] = `Road ${tile}-${validIndex % 5}`;
        tags['addr:housenumber'] = String(validIndex + 1);
      }
      const geometry = invalidId !== null
        ? [
            { lon: x, lat: y },
            { lon: x + size, lat: y + size },
            { lon: x, lat: y + size },
            { lon: x + size, lat: y },
            { lon: x, lat: y },
          ]
        : [
            { lon: x, lat: y },
            { lon: x + size, lat: y },
            { lon: x + size, lat: y + size },
            { lon: x, lat: y + size },
            { lon: x, lat: y },
          ];
      buildingTiles[tile].push({ type: 'way', id, tags, geometry });
      if (invalidId === null) validIndex += 1;
    }
  }

  assert.equal(buildingTiles.flat().length, 2_707);
  assert.equal(validIndex, 2_704);
  return { roadTiles, buildingTiles };
}

function installArea(db: NetworkD1, areaId: string, geometry = BENCHMARK_GEOMETRY) {
  const geometryJson = JSON.stringify(geometry);
  if (areaId === 'area_n') {
    db.sqlite.prepare('UPDATE areas SET geometry_json=?,updated_at=? WHERE id=?').run(geometryJson, STAMP, areaId);
    return;
  }
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES(?,'campaign_n','team_n',?,?,?,?)")
    .run(areaId, `Area ${areaId}`, geometryJson, STAMP, STAMP);
}

function fixtureFetch(fixture: Fixture, onCall?: (kind: 'roads' | 'buildings', tile: number) => void): typeof fetch {
  let roadTile = 0;
  let buildingTile = 0;
  return async (_input, init) => {
    const query = new URLSearchParams(String(init?.body ?? '')).get('data') ?? '';
    const kind = query.includes('way["highway"]') ? 'roads' : 'buildings';
    const tile = kind === 'roads' ? roadTile++ : buildingTile++;
    onCall?.(kind, tile);
    const elements = kind === 'roads' ? fixture.roadTiles[tile] : fixture.buildingTiles[tile];
    if (!elements) throw new Error(`fixture_tile_out_of_range:${kind}:${tile}`);
    return new Response(JSON.stringify({ osm3s: { timestamp_osm_base: '2026-09-16T06:45:00Z' }, elements }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function runPipeline(db: NetworkD1, areaId: string, fetchImpl: typeof fetch): Promise<PipelineSample> {
  let clock = Date.parse(STAMP);
  const options: AreaTaskPreparationOptions = {
    now: () => new Date(clock += 5),
    fetchImpl,
  };
  const started = await beginAreaTaskPreparation(db, 'campaign_n', areaId, options);
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') throw new Error('benchmark_begin_failed');

  const phaseWallMs: Record<string, number> = {};
  const wallStart = performance.now();
  let steps = 0;
  let final: Awaited<ReturnType<typeof runAreaTaskPreparation>> = { outcome: 'pending' };
  for (; steps < 1_024; steps += 1) {
    const before = db.sqlite.prepare('SELECT phase FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=?')
      .get('campaign_n', areaId, started.run.generation) as { phase: string } | undefined;
    const phase = before?.phase ?? 'roads';
    const stepStart = performance.now();
    final = await runAreaTaskPreparation(db, started.run, options);
    phaseWallMs[phase] = (phaseWallMs[phase] ?? 0) + performance.now() - stepStart;
    if (final.outcome !== 'pending') {
      steps += 1;
      break;
    }
  }
  assert.equal(final.outcome, 'ready', JSON.stringify(final));
  if (final.outcome !== 'ready') throw new Error('benchmark_not_ready');
  assert.equal(final.houseCount, 602);

  const job = db.sqlite.prepare('SELECT metrics_json,attempts,error_code FROM street_network_jobs WHERE campaign_id=? AND area_id=?')
    .get('campaign_n', areaId) as { metrics_json: string; attempts: number; error_code: string | null };
  const metrics = JSON.parse(job.metrics_json) as Record<string, any>;
  assert.equal(metrics.tiles, 4);
  assert.equal(metrics.quality.receivedBuildings, 2_707);
  assert.equal(metrics.quality.acceptedBuildings, 2_704);
  assert.equal(metrics.quality.rejectedBuildings, 3);
  assert.equal(metrics.addressableBuildings, 602);
  assert.equal(metrics.houses, 602);
  assert.deepEqual(
    [...metrics.quality.samples.map((sample: { osmId: number }) => sample.osmId)].sort((a, b) => a - b),
    [...INVALID_POLYGON_IDS].sort((a, b) => a - b),
  );
  assert.equal(job.attempts, 0);
  assert.equal(job.error_code, null);
  return {
    totalMs: performance.now() - wallStart,
    steps,
    nominalAlarmWaitMs: Math.max(0, steps - 1) * 100,
    phaseWallMs,
    metrics,
    externalCalls: Number(metrics.requests ?? 0),
  };
}

function compact(sample: PipelineSample) {
  const tileTimings = (sample.metrics.tileTimings ?? []) as Array<{ kind: string; elapsedMs: number }>;
  return {
    totalMs: round(sample.totalMs),
    steps: sample.steps,
    nominalAlarmWaitMs: sample.nominalAlarmWaitMs,
    externalCalls: sample.externalCalls,
    cacheHits: sample.metrics.cacheHits ?? 0,
    roadTileMs: round(tileTimings.filter((tile) => tile.kind === 'roads').reduce((sum, tile) => sum + tile.elapsedMs, 0)),
    buildingTileMs: round(tileTimings.filter((tile) => tile.kind === 'buildings').reduce((sum, tile) => sum + tile.elapsedMs, 0)),
    parseMs: round(sample.metrics.parseMs ?? 0),
    normalizationMs: round(sample.metrics.normalizationMs ?? 0),
    graphMs: round(sample.metrics.graphMs ?? 0),
    addressMs: round(sample.metrics.addressMs ?? 0),
    linkMs: round(sample.metrics.linkMs ?? 0),
    publishMs: round(sample.metrics.publishMs ?? 0),
    phaseWallMs: Object.fromEntries(Object.entries(sample.phaseWallMs).map(([key, value]) => [key, round(value)])),
  };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: round(sorted[0]), median: round(sorted[Math.floor(sorted.length / 2)]), max: round(sorted.at(-1)!) };
}

function summarize(samples: PipelineSample[]) {
  const fields = ['totalMs', 'nominalAlarmWaitMs'] as const;
  const summary: Record<string, ReturnType<typeof distribution>> = {};
  for (const field of fields) summary[field] = distribution(samples.map((sample) => sample[field]));
  for (const phase of ['roads', 'graph', 'buildings', 'addresses', 'link', 'publish']) {
    summary[`${phase}WallMs`] = distribution(samples.map((sample) => sample.phaseWallMs[phase] ?? 0));
  }
  summary.parseMs = distribution(samples.map((sample) => sample.metrics.parseMs ?? 0));
  summary.normalizationMs = distribution(samples.map((sample) => sample.metrics.normalizationMs ?? 0));
  summary.graphMetricMs = distribution(samples.map((sample) => sample.metrics.graphMs ?? 0));
  summary.addressMetricMs = distribution(samples.map((sample) => sample.metrics.addressMs ?? 0));
  summary.linkMetricMs = distribution(samples.map((sample) => sample.metrics.linkMs ?? 0));
  summary.publishMetricMs = distribution(samples.map((sample) => sample.metrics.publishMs ?? 0));
  return summary;
}

test('speed audit: 2707 raw buildings -> 602 houses, cold and warm cache, three runs each', async (t) => {
  const fixture = makeFixture();
  assert.equal(preparationTiles({ geometry: BENCHMARK_GEOMETRY } as any).length, 4);
  const cold: PipelineSample[] = [];
  const warm: PipelineSample[] = [];

  for (let run = 0; run < 3; run += 1) {
    const db = new NetworkD1(true);
    seedNetwork(db);
    installArea(db, 'area_n');
    let coldCalls = 0;
    cold.push(await runPipeline(db, 'area_n', fixtureFetch(fixture, () => { coldCalls += 1; })));
    assert.equal(coldCalls, 8);
    assert.equal(cold.at(-1)!.externalCalls, 8);
    assert.equal(cold.at(-1)!.metrics.cacheHits ?? 0, 0);

    const warmArea = `area_warm_${run}`;
    installArea(db, warmArea);
    let warmCalls = 0;
    const warmFetch: typeof fetch = async () => {
      warmCalls += 1;
      throw new Error('warm_source_cache_miss');
    };
    warm.push(await runPipeline(db, warmArea, warmFetch));
    assert.equal(warmCalls, 0);
    assert.equal(warm.at(-1)!.externalCalls, 0);
    assert.equal(warm.at(-1)!.metrics.cacheHits, 8);
    db.sqlite.close();
  }

  const budgetDb = new BudgetD1(true);
  seedNetwork(budgetDb);
  installArea(budgetDb, 'area_n');
  budgetDb.resetBudget();
  await runPipeline(budgetDb, 'area_n', fixtureFetch(fixture));
  const budget = budgetDb.report();
  budgetDb.sqlite.close();

  t.diagnostic(JSON.stringify({
    audit: 'street-engine-speed-2707-602',
    fixture: { tiles: 4, roads: 20, rawBuildings: 2_707, acceptedBuildings: 2_704, invalidPolygons: [...INVALID_POLYGON_IDS], houses: 602 },
    coldRuns: cold.map(compact),
    warmRuns: warm.map(compact),
    coldSummary: summarize(cold),
    warmSummary: summarize(warm),
    d1: budget,
  }));
});

test('504 audit: primary 504 falls back within the same cursor without consuming a job retry', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];
  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      return url === PRIMARY ? new Response('', { status: 504 }) : networkOsm();
    },
  });
  assert.equal(result.outcome, 'ready');
  assert.deepEqual(urls, [PRIMARY, FALLBACK, PRIMARY, FALLBACK]);
  const job = db.sqlite.prepare('SELECT attempts,error_code,metrics_json FROM street_network_jobs').get() as { attempts: number; error_code: string | null; metrics_json: string };
  const metrics = JSON.parse(job.metrics_json);
  assert.equal(job.attempts, 0);
  assert.equal(job.error_code, null);
  assert.equal(metrics.requests, 4);
  assert.equal(metrics.retries ?? 0, 0);
  assert.deepEqual(metrics.tileTimings.map((tile: { attempts: number }) => tile.attempts), [2, 2]);
  db.sqlite.close();
});

test('504 audit: both providers stop after three job attempts, publish nothing, and expose retry cost separately', async (t) => {
  const db = new NetworkD1();
  seedNetwork(db);
  let calls = 0;
  let clock = Date.parse('2026-09-16T07:00:00.000Z');
  const syntheticProviderLatencyMs = 20;
  const start = performance.now();
  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    now: () => new Date(clock += 5_000),
    fetchImpl: async () => {
      calls += 1;
      await sleep(syntheticProviderLatencyMs);
      return new Response('', { status: 504 });
    },
  });
  const elapsedMs = performance.now() - start;
  assert.equal(result.outcome, 'failed');
  assert.equal(calls, 6, 'two providers x three job attempts');
  const job = db.sqlite.prepare('SELECT phase,cursor,attempts,error_code,metrics_json FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number; error_code: string; metrics_json: string };
  assert.deepEqual({ phase: job.phase, cursor: job.cursor, attempts: job.attempts, error: job.error_code }, { phase: 'roads', cursor: 0, attempts: 3, error: 'overpass_http_504' });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tasks').get()!.n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n, 0);
  const metrics = JSON.parse(job.metrics_json);
  assert.equal(metrics.requests, 6);
  assert.equal(metrics.retries, 3);
  assert.ok(elapsedMs >= syntheticProviderLatencyMs * 6, `elapsed=${elapsedMs}`);
  t.diagnostic(JSON.stringify({
    audit: 'street-engine-504-cost',
    providerCalls: calls,
    syntheticProviderLatencyMs,
    measuredWallMs: round(elapsedMs),
    nominalRetryBackoffBeforeThirdAttemptMs: { min: 3_100, max: 3_598 },
    configuredPerProviderDeadlineMs: 18_000,
    configuredOverpassQueryTimeoutSeconds: 15,
  }));
  db.sqlite.close();
});

test('504 audit: stored tile survives terminal failure and manual restart resumes the missing cursor', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const geometry = { type: 'Polygon' as const, coordinates: [[[13, 51], [13.02, 51], [13.02, 51.01], [13, 51.01], [13, 51]]] };
  installArea(db, 'area_n', geometry);
  assert.equal(preparationTiles({ geometry } as any).length, 2);

  let clock = Date.parse(STAMP);
  let allowSecondTile = false;
  const roadQueries: string[] = [];
  const options: AreaTaskPreparationOptions = {
    now: () => new Date(clock += 5_000),
    fetchImpl: async (_input, init) => {
      const query = new URLSearchParams(String(init?.body ?? '')).get('data') ?? '';
      if (!query.includes('way["highway"]')) return networkOsm();
      roadQueries.push(query);
      if (roadQueries.length === 1 || allowSecondTile) return networkOsm();
      return new Response('', { status: 504 });
    },
  };

  const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', options);
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') throw new Error('missing_initial_run');
  assert.equal((await runAreaTaskPreparation(db, started.run, options)).outcome, 'pending');
  let job = db.sqlite.prepare('SELECT phase,cursor,attempts FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number };
  assert.deepEqual({ ...job }, { phase: 'roads', cursor: 1, attempts: 0 });
  const stagedAfterFirstTile = Number(db.sqlite.prepare("SELECT COUNT(*) n FROM street_network_staging WHERE kind='roads'").get()!.n);
  assert.ok(stagedAfterFirstTile > 0);

  assert.equal((await runAreaTaskPreparation(db, started.run, options)).outcome, 'pending');
  assert.equal((await runAreaTaskPreparation(db, started.run, options)).outcome, 'pending');
  const failed = await runAreaTaskPreparation(db, started.run, options);
  assert.equal(failed.outcome, 'failed');
  job = db.sqlite.prepare('SELECT phase,cursor,attempts FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number };
  assert.deepEqual({ ...job }, { phase: 'roads', cursor: 1, attempts: 3 });
  assert.equal(Number(db.sqlite.prepare("SELECT COUNT(*) n FROM street_network_staging WHERE kind='roads'").get()!.n), stagedAfterFirstTile);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tasks').get()!.n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n, 0);

  allowSecondTile = true;
  const restarted = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', options);
  assert.equal(restarted.outcome, 'run');
  if (restarted.outcome !== 'run') throw new Error('missing_restart_run');
  assert.equal(restarted.run.generation, started.run.generation);
  job = db.sqlite.prepare('SELECT phase,cursor,attempts FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number };
  assert.deepEqual({ ...job }, { phase: 'roads', cursor: 1, attempts: 3 });
  assert.equal((await runAreaTaskPreparation(db, restarted.run, options)).outcome, 'pending');
  job = db.sqlite.prepare('SELECT phase,cursor,attempts FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number };
  assert.deepEqual({ ...job }, { phase: 'graph', cursor: 0, attempts: 0 });
  const firstTileQuery = roadQueries[0];
  assert.equal(roadQueries.filter((query) => query === firstTileQuery).length, 1, 'cursor 0 must not be fetched again');
  assert.equal(new Set(roadQueries).size, 2, 'all failed/restarted requests target cursor 1');

  let final: Awaited<ReturnType<typeof runAreaTaskPreparation>> = { outcome: 'pending' };
  for (let step = 0; step < 64 && final.outcome === 'pending'; step += 1) final = await runAreaTaskPreparation(db, restarted.run, options);
  assert.equal(final.outcome, 'ready');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tasks').get()!.n > 0, true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n > 0, true);
  db.sqlite.close();
});

test('retry audit: explicit non-transient HTTP 400 fails once instead of entering provider/job retry loops', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  let calls = 0;
  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    upstreamUrl: 'https://example.test/overpass',
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: 400 });
    },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(calls, 1);
  const job = db.sqlite.prepare('SELECT phase,cursor,attempts,error_code FROM street_network_jobs').get() as { phase: string; cursor: number; attempts: number; error_code: string };
  assert.deepEqual({ ...job }, { phase: 'roads', cursor: 0, attempts: 1, error_code: 'overpass_http_400' });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tasks').get()!.n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n, 0);
  db.sqlite.close();
});