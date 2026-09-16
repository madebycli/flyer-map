import assert from 'node:assert/strict';
import test from 'node:test';
import { beginAreaTaskPreparation, runAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
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
