import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { BudgetD1 } from '../tests/helpers/d1Budget.ts';
import { seedNetwork } from '../tests/helpers/networkD1.ts';
import { beginAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { requestDatabase } from '../worker/requestDatabase.ts';
import { PreparationRunner } from '../worker/streetNetwork/runner.ts';
import { buildStreetEngineV4PbfPack, type StreetEngineV4PbfFeature } from '../worker/streetNetwork/v4PbfPackBuilder.ts';
import { runStreetEngineV4Preparation } from '../worker/streetNetwork/v4Preparation.ts';
import { streetEngineV3SourceObjectKey } from '../src/domain/streetEngineV3SourcePack.ts';
import { streetEngineV3ManifestObjectKey, streetEngineV3PointerKey } from '../worker/streetNetwork/v3SourceRuntime.ts';

const results = [];
const mode = process.argv[3] ?? 'direct';
for (const houses of [1_000, 20_000]) {
  const db = new BudgetD1(true);
  try {
    seedNetwork(db);
    const features: StreetEngineV4PbfFeature[] = [];
    for (let road = 0; road < 20; road++) {
      const x = 13.00015 + road * 0.00049;
      features.push({ type: 'Feature', properties: { '@type': 'way', '@id': 10 + road, highway: 'residential', name: `Road ${road}` },
        geometry: { type: 'LineString', coordinates: [[x, 51.0001], [x, 51.0099]] } });
    }
    for (let i = 0; i < houses; i++) {
      const x = 13.00018 + (i % 20) * 0.00049, y = 51.00015 + Math.floor(i / 20) * 0.000009;
      features.push({ type: 'Feature', properties: { '@type': 'way', '@id': 1_000 + i, building: 'yes', 'addr:street': `Road ${i % 20}`, 'addr:housenumber': String(Math.floor(i / 20) + 1) },
        geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.00002, y], [x + 0.00002, y + 0.000005], [x, y + 0.000005], [x, y]]] } });
    }
    const pack = await buildStreetEngineV4PbfPack({ features, coverageBounds: [13, 51, 13.01, 51.01], sourceTimestamp: '2026-10-07T00:00:00Z', provider: 'synthetic-audit-fixture' });
    const objects = new Map<string, Uint8Array>();
    objects.set(streetEngineV3PointerKey('beta'), new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, channel: 'beta', manifestHash: pack.manifestHash })));
    objects.set(streetEngineV3ManifestObjectKey(pack.manifestHash), new TextEncoder().encode(pack.manifestJson));
    for (const [id, bytes] of pack.shardObjects) objects.set(streetEngineV3SourceObjectKey(id), bytes);
    const bucket = { async get(key: string) { const bytes = objects.get(key); return bytes ? { async arrayBuffer() { return bytes.slice().buffer; }, async text() { return new TextDecoder().decode(bytes); } } : null; } };
    db.resetBudget();
    const begun = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n');
    if (begun.outcome !== 'run') throw new Error('missing run');
    const options = { streetEngineVersion: 'v4' as const, streetEngineV4Bucket: bucket, streetEngineV4Channel: 'beta' };
    const storage = { values: new Map<string, unknown>(), at: null as number | null,
      async get<T>(key: string) { return this.values.get(key) as T | undefined; },
      async put(key: string, value: unknown) { this.values.set(key, value); },
      async getAlarm() { return this.at; }, async setAlarm(at: number) { this.at = at; }, async deleteAlarm() { this.at = null; } };
    const runner = mode === 'runner' ? new PreparationRunner(storage, db, options) : null;
    if (runner) await runner.schedule('campaign_n');
    const started = performance.now();
    let maxStatementsPerStep = 0, steps = 0, outcome;
    for (; steps < 2_000; steps++) {
      const statements = db.statements;
      if (runner) {
        await runner.alarm();
        const state = db.sqlite.prepare('SELECT status,road_count,house_count,last_error_code FROM area_task_preparations').get()!;
        outcome = state.status === 'pending' ? { outcome: 'pending' as const }
          : state.status === 'ready' ? { outcome: 'ready' as const, roadCount: Number(state.road_count), houseCount: Number(state.house_count), generation: begun.run.generation }
          : { outcome: 'failed' as const, errorCode: state.last_error_code };
      } else {
        outcome = await runStreetEngineV4Preparation(requestDatabase(db, 50), begun.run, options);
      }
      maxStatementsPerStep = Math.max(maxStatementsPerStep, db.statements - statements);
      if (outcome.outcome !== 'pending') break;
    }
    assert.equal(outcome?.outcome, 'ready', JSON.stringify({ outcome, mode, steps, job: db.sqlite.prepare('SELECT phase,cursor,error_code FROM street_network_jobs').get() }));
    if (outcome?.outcome !== 'ready') throw new Error('not ready');
    assert.equal(outcome.houseCount, houses);
    const job = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
    const metrics = JSON.parse(job.metrics_json);
    assert.equal(metrics.legacyOverpassRequests, 0);
    results.push({ inputHouses: houses, sourceShards: pack.shardObjects.size, steps: steps + 1, maxStatementsPerStep,
      durationMs: performance.now() - started, outcome, logicalBudget: db.report(), metrics });
    console.error(JSON.stringify({ inputHouses: houses, outcome, maxStatementsPerStep }));
  } finally { db.sqlite.close(); }
}
const report = { at: new Date().toISOString(), node: process.version, mode,
  method: 'synthetic V4 local SQLite pipeline, 20 roads, in-memory immutable source; 50-query wrapper per step; pack build excluded; TEMP-trigger logical writes, approximate index/read model; no Cloudflare billing or isolate memory claim', results };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(JSON.stringify(report));
