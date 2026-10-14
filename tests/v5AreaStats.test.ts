import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign, setup, stamp } from './helpers/v5Setup.ts';
import { forgetProgress } from '../worker/v5/areaStats.ts';

const base = `/api/v5/campaigns/${campaign}`;
type Progress = { areas: Record<string, { houses: number; segments: number; units: number; completed: number; later: number; notDeliverable: number }> };

function pack(db: Awaited<ReturnType<typeof setup>>['db'], unit: string, version: number) {
  db.sqlite.prepare("INSERT OR REPLACE INTO v5_pack_meta(campaign_id,area_id,version,chunks,total_bytes,engine,stats_json,built_at,geometry_hash) VALUES(?,?,?,0,0,'v5','{}','2026-10-12T00:00:00.000Z','')").run(campaign, unit, version);
}

test('area stats: admins report the size of units, everybody reads the sums of their Gebiete with the done counts', async () => {
  const { call, db } = await setup();
  pack(db, 'area_n', 3); pack(db, 'area_o', 1); // a big Gebiet's version is the one of its marker row
  const units = [
    { unit: 'area_n~0', area: 'area_n', packVersion: 3, houses: 100, segments: 300 },
    { unit: 'area_n~1', area: 'area_n', packVersion: 3, houses: 50, segments: 120 },
    { unit: 'area_o', area: 'area_o', packVersion: 1, houses: 7, segments: 9 },
  ];
  assert.equal((await call('admin', 'PUT', `${base}/areas/stats`, { units })).status, 200);
  const ops = [['h:a', 'completed'], ['h:b', 'completed'], ['h:c', 'later'], ['h:d', 'not-deliverable'], ['s:x', 'completed']].map(([key, status], i) => ({ id: stamp(1_800_000_000_000 + i), key, status, area: 'area_n' }));
  assert.equal((await call('editor', 'POST', `${base}/ops`, { ops })).status, 200);

  const admin = (await (await call('admin', 'GET', `${base}/progress`)).json()) as Progress;
  assert.deepEqual(admin.areas.area_n, { houses: 150, segments: 420, units: 2, completed: 2, later: 1, notDeliverable: 1 }, 'street pieces are not counted as done houses');
  assert.equal(admin.areas.area_o.houses, 7);
  const editor = (await (await call('editor', 'GET', `${base}/progress`)).json()) as Progress;
  assert.deepEqual(Object.keys(editor.areas), ['area_n'], 'a team sees only its own Gebiete');
});

test('area stats: only admins report; bad input and foreign units are refused; a rebuilt pack makes old numbers vanish', async () => {
  const { call, db } = await setup();
  pack(db, 'area_n', 1);
  const unit = { unit: 'area_n', area: 'area_n', packVersion: 1, houses: 10, segments: 20 };
  for (const who of ['editor', 'viewer', null]) assert.ok([401, 403].includes((await call(who, 'PUT', `${base}/areas/stats`, { units: [unit] })).status), `${who}`);
  for (const bad of [{ units: [] }, { units: [{ ...unit, houses: -1 }] }, { units: [{ ...unit, houses: 1.5 }] }, { units: [{ ...unit, unit: 'area_o' }] }, { units: [{ ...unit, area: 'nope', unit: 'nope' }] }, { units: [{ ...unit, unit: 'area_n~x' }] }, { nothing: 1 }]) {
    assert.ok([400, 404].includes((await call('admin', 'PUT', `${base}/areas/stats`, bad)).status), JSON.stringify(bad));
  }
  assert.equal((await call('admin', 'PUT', `${base}/areas/stats`, { units: [unit] })).status, 200);
  assert.equal(((await (await call('admin', 'GET', `${base}/progress`)).json()) as Progress).areas.area_n.houses, 10);
  pack(db, 'area_n', 2); // rebuilt (the build path drops the kept answer): the reported size belongs to version 1
  forgetProgress(campaign);
  assert.equal(((await (await call('admin', 'GET', `${base}/progress`)).json()) as Progress).areas.area_n?.houses ?? 0, 0);
});

test('area stats: the progress answer is kept for 30 s (it reads every done row), and a report makes it fresh at once', async () => {
  const { call, db } = await setup();
  pack(db, 'area_n', 1);
  const unit = { unit: 'area_n', area: 'area_n', packVersion: 1, houses: 10, segments: 20 };
  assert.equal((await call('admin', 'PUT', `${base}/areas/stats`, { units: [unit] })).status, 200);
  const read = async () => ((await (await call('admin', 'GET', `${base}/progress`)).json()) as Progress).areas.area_n;
  assert.equal((await read()).completed, 0);
  db.sqlite.prepare("INSERT INTO v5_state(campaign_id,key,op_id,status,area_id,actor,grant_id,seq) VALUES(?,?,?,?,?,?,?,?)").run(campaign, 'h:z1', stamp(1_800_000_000_000), 'completed', 'area_n', 'x', 'g', 1);
  assert.equal((await read()).completed, 0, 'still the kept answer');
  assert.equal((await call('admin', 'PUT', `${base}/areas/stats`, { units: [unit] })).status, 200);
  assert.equal((await read()).completed, 1, 'a report drops it');
});
