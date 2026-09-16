import assert from 'node:assert/strict';
import test from 'node:test';
import { beginAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { PreparationRunner, type PreparationAlarmStorage } from '../worker/streetNetwork/runner.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

class AlarmStorage implements PreparationAlarmStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, value); }
  async setAlarm(time: number) { this.alarm = time; }
  async getAlarm() { return this.alarm; }
  async deleteAlarm() { this.alarm = null; }
}

test('active PreparationRunner refreshes pending updated_at before a bounded step', async (t) => {
  const db = new NetworkD1();
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const startedAt = new Date('2026-09-16T09:00:00.000Z');
  const heartbeatAt = new Date('2026-09-16T09:02:00.000Z');
  const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', {
    now: () => startedAt,
    fetchImpl: async () => networkOsm(),
  });
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') return;

  const storage = new AlarmStorage();
  const runner = new PreparationRunner(storage, db, {
    now: () => heartbeatAt,
    fetchImpl: async () => networkOsm(),
  });
  await runner.schedule('campaign_n');
  await runner.alarm();

  const row = db.sqlite.prepare("SELECT status,updated_at FROM area_task_preparations WHERE campaign_id='campaign_n' AND area_id='area_n'").get() as { status: string; updated_at: string };
  assert.equal(row.status, 'pending');
  assert.equal(row.updated_at, heartbeatAt.toISOString());
});
