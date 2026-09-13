import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { setCoverage, type CoverageRange } from '../src/domain/streetNetwork.ts';
import type { TaskStatus } from '../src/domain/campaign.ts';
import type { NetworkIntent } from '../src/domain/networkSelection.ts';
import { enqueueNetworkIntent, flushNetworkIntents, queuedNetworkIntents } from '../src/data/networkIntentQueue.ts';
import { handleRxdbPush } from '../worker/rxdbSync.ts';
import type { AccessContext } from '../worker/access.ts';
import { BudgetD1 } from './helpers/d1Budget.ts';
import { seedNetwork } from './helpers/networkD1.ts';

const TOTAL = 100;
const STATUSES: TaskStatus[] = ['open', 'completed', 'later', 'not-deliverable'];
const STAMP = '2026-09-13T00:00:00.000Z';
const ACCESS: AccessContext = { campaignId: 'campaign_n', grantId: 'independent-audit', role: 'admin', teamId: null, label: null };
const AREA = {
  id: 'area_n',
  campaignId: 'campaign_n',
  teamId: 'team_n',
  name: 'Area',
  geometry: { type: 'Polygon' as const, coordinates: [[[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]]] },
  createdAt: STAMP,
  updatedAt: STAMP,
};

function compressReference(cells: TaskStatus[]): CoverageRange[] {
  const result: CoverageRange[] = [];
  let start = 0;
  while (start < cells.length) {
    const status = cells[start];
    let end = start + 1;
    while (end < cells.length && cells[end] === status) end += 1;
    if (status !== 'open') result.push({ from: start, to: end, status });
    start = end;
  }
  return result;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seedDeleteProbe(db: BudgetD1) {
  const polygon = JSON.stringify({ type: 'Polygon', coordinates: [[[13.001, 51.001], [13.002, 51.001], [13.002, 51.002], [13.001, 51.001]]] });
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_other','campaign_n','team_n','Other',?,?,?)")
    .run(JSON.stringify(AREA.geometry), STAMP, STAMP);
  const insert = db.sqlite.prepare("INSERT INTO house_tasks(id,campaign_id,area_id,label,geometry_json,status,created_at,updated_at) VALUES(?,'campaign_n',?,?,?,'open',?,?)");
  db.sqlite.exec('BEGIN');
  for (let index = 0; index < 3; index += 1) insert.run(`target_house_${index}`, 'area_n', `Target ${index}`, polygon, STAMP, STAMP);
  for (let index = 0; index < 2_000; index += 1) insert.run(`unrelated_house_${index}`, 'area_other', `Other ${index}`, polygon, STAMP, STAMP);
  db.sqlite.exec('COMMIT');
  db.resetBudget();
}

async function runAreaDeleteProbe(prepared: boolean) {
  const db = new BudgetD1(true, true);
  seedNetwork(db);
  seedDeleteProbe(db);
  if (prepared) {
    db.sqlite.prepare('INSERT INTO street_base_areas(campaign_id,area_id,generation) VALUES(?,?,?)')
      .run('campaign_n', 'area_n', 'generation-independent-delete');
  }
  db.resetBudget();
  const response = await handleRxdbPush(db, 'campaign_n', 'areas', ACCESS, {
    rows: [{ assumedMasterState: AREA, newDocumentState: { ...AREA, _deleted: true } }],
  });
  const body = await response.json() as { rejections?: unknown[] };
  const report = db.report();
  return { db, response, body, report };
}

test('independent interval oracle preserves untouched work across randomized operations', () => {
  const seed = 0x5eed2026;
  const random = mulberry32(seed);
  const reference: TaskStatus[] = Array.from({ length: TOTAL }, () => 'open' as const);
  let actual: CoverageRange[] = [];

  for (let step = 0; step < 2_000; step += 1) {
    const a = Math.floor(random() * TOTAL);
    const b = Math.floor(random() * TOTAL);
    if (a === b) continue;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    const reverse = random() < 0.5;

    for (let index = from; index < to; index += 1) reference[index] = status;
    actual = setCoverage(actual, reverse ? to : from, reverse ? from : to, status, TOTAL);

    assert.deepEqual(
      actual,
      compressReference(reference),
      `seed=${seed} step=${step} operation=${reverse ? `${to}->${from}` : `${from}->${to}`} status=${status}`,
    );
  }
});

test('prepared Area delete does not read unrelated campaign Houses before compact deletion', async (t) => {
  const { db, response, body, report } = await runAreaDeleteProbe(true);
  t.after(() => db.sqlite.close());
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.rejections ?? [], []);
  assert.ok(report.snapshotRows < 20, JSON.stringify(report));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM areas WHERE id='area_n'").get()!.n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM house_tasks WHERE area_id='area_other'").get()!.n, 2_000);
  t.diagnostic(JSON.stringify({ operation: 'independent-prepared-area-delete', unrelatedHouses: 2_000, ...report }));
});

test('legacy Area delete scopes required child tombstones to the target Area', async (t) => {
  const { db, response, body, report } = await runAreaDeleteProbe(false);
  t.after(() => db.sqlite.close());
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.rejections ?? [], []);
  assert.ok(report.snapshotRows < 50, JSON.stringify(report));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM house_tasks WHERE area_id='area_n'").get()!.n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM house_tasks WHERE area_id='area_other'").get()!.n, 2_000);
  t.diagnostic(JSON.stringify({ operation: 'independent-legacy-area-delete', targetHouses: 3, unrelatedHouses: 2_000, ...report }));
});

test('offline intent queue preserves user order when two actions share one millisecond', async (t) => {
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const originalDateNow = Date.now;
  t.after(() => {
    Date.now = originalDateNow;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    else Reflect.deleteProperty(globalThis, 'fetch');
  });

  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDB, configurable: true, writable: true });
  Date.now = () => 1_700_000_000_000;

  const scope = 'independent-audit:same-tick-order';
  const campaignId = 'campaign_audit';
  const intent = (id: string, status: TaskStatus): NetworkIntent => ({
    id,
    areaId: 'area_audit',
    generation: 'generation_audit',
    start: { point: [13, 51], taskId: 'street_audit' },
    end: { point: [13.001, 51], taskId: 'street_audit' },
    selectedPath: ['street_audit'],
    expectedState: '0'.repeat(64),
    status,
  });

  await enqueueNetworkIntent(scope, campaignId, intent('z-first-action', 'completed'));
  await enqueueNetworkIntent(scope, campaignId, intent('a-second-action', 'later'));

  const calls: string[] = [];
  let firstApplied = false;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as NetworkIntent;
      calls.push(body.id);
      if (body.id === 'a-second-action' && !firstApplied) {
        return Response.json({ code: 'network_work_changed' }, { status: 409 });
      }
      if (body.id === 'z-first-action') firstApplied = true;
      return Response.json({ code: 'applied' }, { status: 200 });
    },
  });

  await flushNetworkIntents(scope, async () => {});
  const remaining = await queuedNetworkIntents(scope);

  assert.deepEqual(
    { calls, remaining: remaining.map((item) => ({ id: item.intent.id, blocked: item.blocked ?? null })) },
    { calls: ['z-first-action', 'a-second-action'], remaining: [] },
    'FIFO must follow user enqueue order even when Date.now() collides; a dependent later action may not block its predecessor',
  );
});
