import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign, NOW, setup, stamp } from './helpers/v5Setup.ts';
import { collectionSessionCookie, createCollectionAccessLink, redeemCollectionAccess } from '../worker/collectionAccess.ts';

const t = '2026-09-07T00:00:00.000Z';
const poly = (x: number) => JSON.stringify({ type: 'Polygon', coordinates: [[[x, 51], [x + 0.01, 51], [x + 0.01, 51.01], [x, 51.01], [x, 51]]] });
const base = `/api/v5/campaigns/${campaign}`;

async function fixture() {
  const env = await setup();
  const { db, cookies } = env;
  const { token } = await createCollectionAccessLink(db, campaign);
  const a = (await redeemCollectionAccess(db, campaign, token))!;
  const b = (await redeemCollectionAccess(db, campaign, token))!;
  cookies.alice = collectionSessionCookie(a.sessionSecret).split(';')[0];
  cookies.bob = collectionSessionCookie(b.sessionSecret).split(';')[0];
  const run = (sql: string, ...args: unknown[]) => db.sqlite.prepare(sql).run(...args);
  run("INSERT INTO collection_main_areas(id,campaign_id,name,geometry_json,created_at,updated_at) VALUES('main',?,'Haupt',?,?,?)", campaign, poly(14), t, t);
  const area = (id: string, x: number, status: string, runId: string | null, label: string | null) =>
    run("INSERT INTO collection_areas(id,campaign_id,main_area_id,name,geometry_json,color,status,run_id,claimed_by_collector_id,claimed_by_label,completed_at,created_at,updated_at) VALUES(?,?, 'main',?,?,'#2563eb',?,?,NULL,?,NULL,?,?)", id, campaign, id, poly(x), status, runId, label, t, t);
  for (const [id, collector, label] of [['runA', a.access.collectorId, 'Nutzer 1'], ['runB', b.access.collectorId, 'Nutzer 2']] as const) {
    run("INSERT INTO collection_runs(id,campaign_id,main_area_id,status,started_at,ended_at,created_by_collector_id,area_ids_json,created_at,updated_at) VALUES(?,?, 'main','active',?,NULL,?,'[]',?,?)", id, campaign, t, collector, t, t);
    run('INSERT INTO collection_run_members(id,run_id,campaign_id,collector_id,label,joined_at,left_at) VALUES(?,?,?,?,?,?,NULL)', `m_${id}`, id, campaign, collector, label, t);
  }
  area('c_open', 14.0, 'open', null, null);
  area('c_alice', 14.02, 'claimed', 'runA', 'Nutzer 1');
  area('c_bob', 14.04, 'in-progress', 'runB', 'Nutzer 2');
  area('c_old', 14.06, 'archived', null, null);
  return { ...env, run, a, b };
}

const op = (id: string, key: string, status: string, area: string) => ({ ops: [{ id, key, status, area }] });
const push = async (call: Awaited<ReturnType<typeof fixture>>['call'], who: string, area: string, key = 'h:x', n = 1) =>
  (await (await call(who, 'POST', `${base}/ops`, op(stamp(NOW - 1000, n), key, 'completed', area))).json()) as { accepted: string[]; rejected: { reason: string }[] };

test('meta: a collector sees the collection side only, with a server-evaluated "writable" per Area', async () => {
  const { call } = await fixture();
  const meta = await (await call('alice', 'GET', `${base}/meta`)).json() as { kind: string; role: string; teamId: null; areas: { id: string; writable: boolean; collection: { status: string; claimedBy: string | null } }[]; teams: unknown[] };
  assert.equal(meta.kind, 'collection');
  assert.equal(meta.role, 'collection-collector');
  assert.deepEqual(meta.areas.map((x) => [x.id, x.writable]).sort(), [['c_alice', true], ['c_bob', false], ['c_open', false]], 'archived is hidden, only the own claimed Area is writable');
  assert.equal(meta.areas.find((x) => x.id === 'c_bob')!.collection.claimedBy, 'Nutzer 2');
  assert.deepEqual(meta.teams, [], 'no distribution teams leak');
  const m2 = meta as unknown as { collectorId: string; collectorLabel: string; mainAreaId: string; runs: { id: string; members: { label: string }[] }[] };
  assert.ok(m2.collectorId.startsWith('collector_') && m2.collectorLabel === 'Nutzer 1' && m2.mainAreaId === 'main');
  assert.deepEqual(m2.runs.map((r) => [r.id, r.members.map((m) => m.label)]), [['runA', ['Nutzer 1']], ['runB', ['Nutzer 2']]], 'active Runs with their current members');
  const rights = (meta as unknown as { pickupRights: { view: boolean; create: boolean; edit: boolean } }).pickupRights;
  assert.deepEqual([rights.create, rights.edit], [false, false], 'a collector without granted capabilities cannot create or edit Sonder-Marker');
  const admin = await (await call('admin', 'GET', `${base}/meta?kind=collection`)).json() as { areas: { id: string; writable: boolean }[] };
  assert.equal(admin.areas.length, 4, 'admin also sees the archived Area');
  assert.ok(admin.areas.filter((x) => x.id !== 'c_old').every((x) => x.writable));
  const dist = await (await call('admin', 'GET', `${base}/meta`)).json() as { kind: string; areas: { id: string }[] };
  assert.equal(dist.kind, 'distribution');
  assert.ok(dist.areas.every((x) => !x.id.startsWith('c_')), 'distribution view never lists collection Areas');
});

test('a collector writes only in an Area that their own active Run holds', async () => {
  const { call } = await fixture();
  assert.deepEqual((await push(call, 'alice', 'c_alice')).accepted.length, 1);
  for (const [area, why] of [['c_bob', "someone else's Run"], ['c_open', 'unclaimed'], ['c_old', 'archived'], ['area_n', 'a distribution Area'], ['nope', 'unknown']] as const) {
    const res = await push(call, 'alice', area, 'h:y', 2);
    assert.deepEqual([res.accepted.length, res.rejected[0]?.reason], [0, 'area_forbidden'], `refused: ${why}`);
  }
});

test('releasing, leaving, closing the Run or revoking the collector stops writes immediately', async () => {
  const { call, run, a } = await fixture();
  assert.equal((await push(call, 'alice', 'c_alice', 'h:1', 1)).accepted.length, 1);
  run("UPDATE collection_run_members SET left_at = ? WHERE run_id = 'runA'", t);
  assert.equal((await push(call, 'alice', 'c_alice', 'h:2', 2)).accepted.length, 0, 'left the Run');
  run("UPDATE collection_run_members SET left_at = NULL WHERE run_id = 'runA'");
  assert.equal((await push(call, 'alice', 'c_alice', 'h:3', 3)).accepted.length, 1, 'back in');
  run("UPDATE collection_areas SET status = 'open', run_id = NULL WHERE id = 'c_alice'");
  assert.equal((await push(call, 'alice', 'c_alice', 'h:4', 4)).accepted.length, 0, 'Area released');
  run("UPDATE collection_areas SET status = 'claimed', run_id = 'runA' WHERE id = 'c_alice'");
  run("UPDATE collection_areas SET status = 'completed' WHERE id = 'c_alice'");
  assert.equal((await push(call, 'alice', 'c_alice', 'h:4b', 7)).accepted.length, 0, 'a completed Area is frozen for collectors');
  run("UPDATE collection_areas SET status = 'claimed' WHERE id = 'c_alice'");
  run("UPDATE collection_runs SET status = 'closed' WHERE id = 'runA'");
  assert.equal((await push(call, 'alice', 'c_alice', 'h:5', 5)).accepted.length, 0, 'Run closed');
  run("UPDATE collection_runs SET status = 'active' WHERE id = 'runA'");
  assert.equal((await push(call, 'alice', 'c_alice', 'h:6', 6)).accepted.length, 1);
  run("UPDATE collection_collectors SET revoked_at = ? WHERE id = ?", t, a.access.collectorId);
  assert.equal((await call('alice', 'GET', `${base}/meta`)).status, 401, 'revoked collector is out');
});

test('two collectors in one Run both write; a second Run cannot take over a key from the first', async () => {
  const { call, run, b } = await fixture();
  run('INSERT INTO collection_run_members(id,run_id,campaign_id,collector_id,label,joined_at,left_at) VALUES(?,?,?,?,?,?,NULL)', 'm_b_in_a', 'runA', campaign, b.access.collectorId, 'Nutzer 2', t);
  assert.equal((await push(call, 'alice', 'c_alice', 'h:shared', 1)).accepted.length, 1);
  assert.equal((await push(call, 'bob', 'c_alice', 'h:shared', 2)).accepted.length, 1, 'joined member may write');
  // bob also works in his own Area, but cannot grab a key that already belongs to c_alice
  const grab = await push(call, 'bob', 'c_bob', 'h:shared', 3);
  assert.deepEqual([grab.accepted.length, grab.rejected[0]?.reason], [0, 'key_owned_elsewhere']);
});

test('reads: collectors see state of collection Areas (not archived, not distribution), never the other way round', async () => {
  const { call } = await fixture();
  await push(call, 'alice', 'c_alice', 'h:a', 1);
  await call('bob', 'POST', `${base}/ops`, op(stamp(NOW - 900), 'h:b', 'later', 'c_bob'));
  await call('admin', 'POST', `${base}/ops`, op(stamp(NOW - 800), 'h:dist', 'completed', 'area_n'));
  await call('admin', 'POST', `${base}/ops`, op(stamp(NOW - 700), 'h:arch', 'completed', 'c_old'));
  const keys = async (who: string) => ((await (await call(who, 'GET', `${base}/state?since=0`)).json()) as { ops: { key: string }[] }).ops.map((o) => o.key).sort();
  assert.deepEqual(await keys('alice'), ['h:a', 'h:b'], 'sees the other Run’s progress, nothing from distribution or archive');
  assert.deepEqual(await keys('editor'), ['h:dist'], 'a team editor sees no collection state');
  assert.deepEqual(await keys('admin'), ['h:a', 'h:b', 'h:dist'], 'nobody writes into an archived Area, admins included');
});

test('collection packs: readable for collectors, buildable only while they hold the Area; other roles cannot reach them', async () => {
  const { call } = await fixture();
  const fetchImpl = (async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 51.001, lon: 14.021 }, { lat: 51.002, lon: 14.022 }] }, { type: 'way', id: 2, tags: { building: 'house', 'addr:housenumber': '1' }, geometry: [{ lat: 51.003, lon: 14.021 }, { lat: 51.003, lon: 14.0212 }, { lat: 51.0032, lon: 14.0212 }, { lat: 51.003, lon: 14.021 }] }] }))) as unknown as typeof fetch;
  assert.equal((await call('alice', 'POST', `${base}/areas/c_bob/pack`, undefined, { fetchImpl })).status, 403, 'not hers');
  assert.equal((await call('alice', 'POST', `${base}/areas/area_n/pack`, undefined, { fetchImpl })).status, 404, 'distribution Area is invisible to a collector');
  assert.equal((await call('alice', 'POST', `${base}/areas/c_alice/pack`, undefined, { fetchImpl })).status, 200);
  assert.equal((await call('bob', 'GET', `${base}/areas/c_alice/pack`)).status, 200, 'any collector can read a collection pack');
  assert.equal((await call('editor', 'GET', `${base}/areas/c_alice/pack`)).status, 404, 'a distribution editor cannot');
  assert.equal((await call('alice', 'GET', `${base}/areas/area_n/pack`)).status, 404);
  assert.equal((await call(null, 'GET', `${base}/areas/c_alice/pack`)).status, 401);
});

test('notes follow the same rule: collectors write notes only in their Area and read notes of collection Areas only', async () => {
  const { call } = await fixture();
  const note = (id: string, area: string, key: string) => ({ notes: [{ id, key, area, flag: 'dog', text: '', rev: id, deleted: false }] });
  const mine = stamp(NOW - 600), theirs = stamp(NOW - 500), dist = stamp(NOW - 400);
  const r1 = await (await call('alice', 'POST', `${base}/notes`, note(mine, 'c_alice', 'h:1'))).json() as { accepted: string[] };
  const r2 = await (await call('alice', 'POST', `${base}/notes`, note(theirs, 'c_bob', 'h:2'))).json() as { accepted: string[]; rejected: { reason: string }[] };
  const r3 = await (await call('alice', 'POST', `${base}/notes`, note(dist, 'area_n', 'h:3'))).json() as { accepted: string[] };
  assert.deepEqual([r1.accepted.length, r2.accepted.length, r2.rejected[0].reason, r3.accepted.length], [1, 0, 'area_forbidden', 0]);
  await call('admin', 'POST', `${base}/notes`, note(stamp(NOW - 300), 'area_n', 'h:4'));
  const seen = ((await (await call('bob', 'GET', `${base}/notes?since=0`)).json()) as { notes: { id: string }[] }).notes.map((n) => n.id);
  assert.deepEqual(seen, [mine], 'bob reads alice’s note in a collection Area, not the distribution note');
});

test('collectors can neither clean up nor forget a Gebiet, not even their own', async () => {
  const { call } = await fixture();
  await call('admin', 'POST', `${base}/ops`, op(stamp(NOW - 900), 'h:keep', 'completed', 'c_alice'));
  for (const who of ['alice', 'bob']) {
    assert.equal((await call(who, 'POST', `${base}/areas/c_alice/prune`, { keys: ['h:keep'] })).status, 403, `${who} prune`);
    assert.equal((await call(who, 'POST', `${base}/areas/c_gone/forget`)).status, 403, `${who} forget`);
  }
  const rows = ((await (await call('admin', 'GET', `${base}/state?since=0`)).json()) as { ops: { key: string; status: string }[] }).ops;
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [['h:keep', 'completed']], 'nothing was cleared');
});
