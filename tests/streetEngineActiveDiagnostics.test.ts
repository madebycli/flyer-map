import assert from 'node:assert/strict';
import test from 'node:test';
import { beginAreaTaskPreparation, getAreaTaskPreparationPublicState, preparationProgress, runAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { getStreetEngineDiagnosticSnapshot } from '../worker/streetNetwork/diagnostics.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

test('Street Engine diagnostics prefer accumulated active runtime over failed/idle wall time', async (t) => {
  const db = new NetworkD1();
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    fetchImpl: async () => networkOsm(),
  });
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') return;

  const firstStep = await runAreaTaskPreparation(db, started.run, {
    fetchImpl: async () => networkOsm(),
  });
  assert.equal(firstStep.outcome, 'pending');

  const job = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(job.metrics_json) as Record<string, unknown>;
  metrics.activeMs = 1_234;
  db.sqlite.prepare('UPDATE street_network_jobs SET metrics_json=?').run(JSON.stringify(metrics));
  db.sqlite.prepare("UPDATE area_task_preparations SET status='failed',started_at=?,failed_at=?,updated_at=? WHERE campaign_id='campaign_n' AND area_id='area_n'")
    .run('2026-09-16T08:00:00.000Z', '2026-09-16T09:00:00.000Z', '2026-09-16T09:00:00.000Z');

  const diagnostic = await getStreetEngineDiagnosticSnapshot(db, 'campaign_n', 'area_n');
  assert.ok(diagnostic);
  assert.equal(diagnostic?.activeElapsedMs, 1_234);
  assert.equal(diagnostic?.elapsedMs, 1_234);
  assert.equal(diagnostic?.wallElapsedMs, 3_600_000);
  assert.equal(diagnostic?.metrics.activeMs, 1_234);
});

test('V4 HTTP progress uses the same shard count as realtime checkpoints and hides the previous failed retry', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n');
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') return;
  db.sqlite.prepare(`INSERT INTO street_network_jobs(
    campaign_id,area_id,generation,geometry_json,phase,cursor,metrics_json
  ) VALUES(?,?,?,?, 'v4-source',5,?)`).run(
    started.run.campaignId, started.run.areaId, started.run.generation,
    JSON.stringify(started.run.area.geometry),
    JSON.stringify({ engineVersion: 'v4', shardCount: 130, addressableBuildings: 64_656 }),
  );
  const http = await getAreaTaskPreparationPublicState(db, started.run.campaignId, started.run.areaId);
  const realtime = preparationProgress('v4-source', 5, 130, { shardCount: 130, addressableBuildings: 64_656 });
  assert.deepEqual(http.progress, realtime);
  assert.equal(http.progress?.totalTiles, 130);
  assert.equal(http.progress?.completedRoadTiles, 5);

  db.sqlite.prepare("UPDATE street_network_jobs SET phase='v4-plan',cursor=0,metrics_json=?").run(JSON.stringify({ engineVersion: 'v4' }));
  const planning = await getAreaTaskPreparationPublicState(db, started.run.campaignId, started.run.areaId);
  assert.equal(planning.progress?.totalTiles, 0, 'no legacy geometry tile count while selecting source shards');

  db.sqlite.prepare("UPDATE street_network_jobs SET phase='failed',error_code='street_engine_v4_publish_internal_failure'").run();
  const restarted = await getAreaTaskPreparationPublicState(db, started.run.campaignId, started.run.areaId);
  assert.equal(restarted.status, 'pending');
  assert.equal(restarted.progress, undefined, 'a previous failed V4 job must not appear as the new attempt');
});
