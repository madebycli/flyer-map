import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';
import { createAccessGrant, createSessionForGrant, resolveAccess, sessionCookie, type PersistentAccessRole } from '../worker/access.ts';
import { handleV5Api } from '../worker/v5/api.ts';
import { decodePack } from '../src/v5/engine/index.ts';
import { encodeClock } from '../src/v5/store/hlc.ts';

const campaign = 'campaign_n';
const stamp = (wall: number, counter = 0, node = 'n') => encodeClock({ wall, counter, node });
const NOW = 1_800_000_000_000;

async function setup() {
  const db = new NetworkD1(false, true);
  seedNetwork(db);
  const t = '2026-09-07T00:00:00.000Z';
  db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_o',?,'Other','#ef4444',?,?)").run(campaign, t, t);
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_o',?,'team_o','Other',?,?,?)")
    .run(campaign, JSON.stringify({ type: 'Polygon', coordinates: [[[13.02, 51], [13.03, 51], [13.03, 51.01], [13.02, 51.01], [13.02, 51]]] }), t, t);
  const cookies: Record<string, string> = {};
  for (const [name, role, teamId] of [['admin', 'admin', null], ['viewer', 'viewer', null], ['editor', 'team-editor', 'team_n'], ['other', 'team-editor', 'team_o']] as [string, PersistentAccessRole, string | null][]) {
    const { grant } = await createAccessGrant(db, { campaignId: campaign, role, teamId, label: name });
    const ctx = (await resolveAccessForGrant(db, grant.grantId))!;
    const session = await createSessionForGrant(db, ctx);
    cookies[name] = `${sessionCookie(session.sessionSecret).split(';')[0]}`;
  }
  const call = async (who: string | null, method: string, path: string, body?: unknown, opts = {}) => {
    const request = new Request(`https://example.test${path}`, {
      method, headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return (await handleV5Api(request, db, { now: () => NOW, ...opts }))!;
  };
  return { db, call };
}

async function resolveAccessForGrant(db: NetworkD1, grantId: string) {
  const row = db.sqlite.prepare('SELECT id, campaign_id, role, team_id, label FROM campaign_access_grants WHERE id=?').get(grantId) as { id: string; campaign_id: string; role: PersistentAccessRole; team_id: string | null; label: string | null };
  return { grantId: row.id, campaignId: row.campaign_id, role: row.role, teamId: row.team_id, label: row.label };
}

const ops = (...items: [string, string, string, string?][]) => ({ ops: items.map(([id, key, status, area]) => ({ id, key, status, area: area ?? 'area_n' })) });

test('unauthenticated requests are rejected, unknown v5 routes 404, others pass through', async () => {
  const { call } = await setup();
  assert.equal((await call(null, 'GET', `/api/v5/campaigns/${campaign}/state`)).status, 401);
  assert.equal((await call('admin', 'GET', '/api/v5/nonsense')).status, 404);
  const outside = await handleV5Api(new Request('https://example.test/api/campaigns'), new NetworkD1());
  assert.equal(outside, null);
});

test('ops are stored last-writer-wins, idempotent, and pulled incrementally', async () => {
  const { call } = await setup();
  const first = await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 5000), 'h:a', 'completed'], [stamp(NOW - 4000), 'h:b', 'later'], [stamp(NOW - 3000), 's:x#1', 'completed']));
  const body1 = await first.json() as { accepted: string[]; rejected: unknown[]; cursor: number };
  assert.equal(body1.accepted.length, 3);
  assert.deepEqual(body1.rejected, []);
  const pull1 = await (await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/state?since=0`)).json() as { ops: { key: string; status: string; by: string }[]; cursor: number; more: boolean };
  assert.deepEqual(pull1.ops.map((o) => [o.key, o.status]).sort(), [['h:a', 'completed'], ['h:b', 'later'], ['s:x#1', 'completed']]);
  assert.equal(pull1.ops[0].by, 'admin');
  assert.equal(pull1.more, false);
  // An older write loses; the same write again changes nothing; a newer write wins and re-appears after the cursor.
  await call('editor', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 9000), 'h:a', 'later']));
  await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 5000), 'h:a', 'completed']));
  const quiet = await (await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/state?since=${pull1.cursor}`)).json() as { ops: unknown[] };
  assert.equal(quiet.ops.length, 0, 'losing and duplicate writes produce no new state');
  await call('editor', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 100), 'h:a', 'not-deliverable']));
  const later = await (await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/state?since=${pull1.cursor}`)).json() as { ops: { key: string; status: string; by: string }[] };
  assert.deepEqual(later.ops.map((o) => [o.key, o.status, o.by]), [['h:a', 'not-deliverable', 'editor']]);
});

test('invalid operations are rejected individually without blocking valid ones', async () => {
  const { call } = await setup();
  const response = await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, {
    ops: [
      { id: stamp(NOW - 10), key: 'h:ok', status: 'completed', area: 'area_n' },
      { id: 'garbage', key: 'h:x', status: 'completed', area: 'area_n' },
      { id: stamp(NOW - 9), key: 'x:bad key', status: 'completed', area: 'area_n' },
      { id: stamp(NOW - 8), key: 'h:y', status: 'finished', area: 'area_n' },
      { id: stamp(NOW + 5 * 24 * 3600 * 1000), key: 'h:z', status: 'completed', area: 'area_n' },
      { id: stamp(NOW - 7), key: 'h:w', status: 'completed', area: 'missing_area' },
    ],
  });
  const body = await response.json() as { accepted: string[]; rejected: { reason: string }[] };
  assert.equal(body.accepted.length, 1);
  assert.deepEqual(body.rejected.map((r) => r.reason), ['bad_id', 'bad_key', 'bad_status', 'clock_future', 'area_forbidden']);
  assert.equal((await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, { ops: [] })).status, 400);
});

test('roles: viewers cannot write; teams are confined to their own areas', async () => {
  const { call } = await setup();
  const write = (who: string, area: string, wall: number) => call(who, 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(wall), `h:${who}${area}`, 'completed', area]));
  assert.equal((await write('viewer', 'area_n', NOW - 50)).status, 403);
  assert.equal(((await (await write('editor', 'area_n', NOW - 49)).json()) as { accepted: string[] }).accepted.length, 1);
  const foreign = await (await write('editor', 'area_o', NOW - 48)).json() as { accepted: string[]; rejected: { reason: string }[] };
  assert.deepEqual([foreign.accepted.length, foreign.rejected[0].reason], [0, 'area_forbidden']);
  await write('other', 'area_o', NOW - 47);
  const seen = await (await call('editor', 'GET', `/api/v5/campaigns/${campaign}/state`)).json() as { ops: { key: string }[] };
  assert.deepEqual(seen.ops.map((o) => o.key), ['h:editorarea_n'], 'editor never sees the other team’s state');
  const admin = await (await call('admin', 'GET', `/api/v5/campaigns/${campaign}/state`)).json() as { ops: unknown[] };
  assert.equal(admin.ops.length, 2);
});

test('pull paginates with a stable cursor', async () => {
  const { call } = await setup();
  const items: [string, string, string][] = Array.from({ length: 30 }, (_, i) => [stamp(NOW - 1000 + i), `h:k${i}`, 'completed']);
  for (let i = 0; i < items.length; i += 10) await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops(...items.slice(i, i + 10)));
  let cursor = 0, total = 0, pages = 0;
  for (;;) {
    const page = await (await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/state?since=${cursor}&limit=7`)).json() as { ops: unknown[]; cursor: number; more: boolean };
    total += page.ops.length; cursor = page.cursor; pages++;
    if (!page.more) break;
  }
  assert.deepEqual([total, pages], [30, 5]);
});

const overpassOk = () => new Response(JSON.stringify({ elements: [
  { type: 'way', id: 1, nodes: [1, 2], geometry: [{ lat: 51.005, lon: 13.001 }, { lat: 51.005, lon: 13.009 }], tags: { highway: 'residential', name: 'Teststraße' } },
  { type: 'way', id: 2, nodes: [3, 4, 5, 3], geometry: [{ lat: 51.0051, lon: 13.002 }, { lat: 51.0051, lon: 13.00203 }, { lat: 51.00513, lon: 13.00203 }, { lat: 51.0051, lon: 13.002 }], tags: { building: 'house', 'addr:housenumber': '1', 'addr:street': 'Teststraße' } },
] }));

test('pack build stores a compressed raw pack that clients can read back, with team scoping', async () => {
  const { call } = await setup();
  let requested = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => { requested = String(init?.body); return overpassOk(); }) as unknown as typeof fetch;
  assert.equal((await call('viewer', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl })).status, 403);
  assert.equal((await call('other', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl })).status, 404); // an area of another team does not even reveal that it exists
  const built = await call('editor', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl });
  assert.equal(built.status, 200);
  assert.match(decodeURIComponent(requested), /out geom qt;/);
  const info = await built.json() as { version: number; stats: { ways: number; buildings: number } };
  assert.deepEqual([info.version, info.stats.ways, info.stats.buildings], [1, 1, 1]);
  assert.equal((await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl })).status, 429, 'rebuild cooldown');
  const rebuilt = await (await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl, now: () => NOW + 120_000 })).json() as { version: number };
  assert.equal(rebuilt.version, 2);
  const got = await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/areas/area_n/pack`);
  assert.equal(got.headers.get('x-pack-version'), '2');
  const raw = await decodePack(new Uint8Array(await got.arrayBuffer()));
  assert.equal(raw.ways[0].tags.name, 'Teststraße');
  assert.equal((await call('other', 'GET', `/api/v5/campaigns/${campaign}/areas/area_n/pack`)).status, 404);
  assert.equal((await call('admin', 'GET', `/api/v5/campaigns/${campaign}/areas/area_o/pack`)).status, 404, 'no pack built yet');
});

test('pack build fails closed: upstream errors, invalid bodies, empty results', async () => {
  const { call } = await setup();
  let clock = NOW;
  const post = (fetchImpl: typeof fetch) => call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl, now: () => (clock += 120_000) });
  assert.equal((await post((async () => new Response('busy', { status: 429 })) as unknown as typeof fetch)).status, 502);
  assert.equal((await post((async () => { throw new Error('net'); }) as unknown as typeof fetch)).status, 502);
  assert.equal((await post((async () => new Response('<html>')) as unknown as typeof fetch)).status, 502);
  assert.equal((await post((async () => new Response(JSON.stringify({ elements: [] }))) as unknown as typeof fetch)).status, 422);
  assert.equal((await call('admin', 'GET', `/api/v5/campaigns/${campaign}/areas/area_n/pack`)).status, 404, 'failed builds leave no pack behind');
});

test('oversized areas are refused before any upstream request', async () => {
  const { db, call } = await setup();
  db.sqlite.prepare('UPDATE areas SET geometry_json=? WHERE id=?').run(JSON.stringify({ type: 'Polygon', coordinates: [[[13, 51], [13.5, 51], [13.5, 51.5], [13, 51.5], [13, 51]]] }), 'area_n');
  let called = false;
  const fetchImpl = (async () => { called = true; return overpassOk(); }) as unknown as typeof fetch;
  const response = await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl });
  assert.equal(response.status, 422);
  assert.equal(called, false);
});

test('meta gives role, scoped areas and pack versions in one request', async () => {
  const { call } = await setup();
  const admin = await (await call('admin', 'GET', `/api/v5/campaigns/${campaign}/meta`)).json() as { areas: { id: string; packVersion: number | null }[]; teams: unknown[]; canWrite: boolean; canBuildPack: boolean };
  assert.deepEqual(admin.areas.map((a) => a.id).sort(), ['area_n', 'area_o']);
  assert.ok(admin.areas.every((a) => typeof (a as { updatedAt?: string }).updatedAt === 'string' && (a as { updatedAt: string }).updatedAt.length > 0), 'areas carry updatedAt for optimistic edits');
  assert.equal(admin.teams.length, 2);
  const viewer = await (await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/meta`)).json() as { canWrite: boolean; canBuildPack: boolean };
  assert.deepEqual([viewer.canWrite, viewer.canBuildPack], [false, false]);
  const editor = await (await call('editor', 'GET', `/api/v5/campaigns/${campaign}/meta`)).json() as { areas: { id: string }[]; teams: unknown[]; canWrite: boolean };
  assert.deepEqual(editor.areas.map((a) => a.id), ['area_n']);
  assert.equal(editor.teams.length, 1);
  await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl: (async () => overpassOk()) as unknown as typeof fetch });
  const after = await (await call('admin', 'GET', `/api/v5/campaigns/${campaign}/meta`)).json() as { areas: { id: string; packVersion: number | null }[] };
  assert.equal(after.areas.find((a) => a.id === 'area_n')!.packVersion, 1);
});

test('sequence numbers are strictly increasing and unique across interleaved batches', async () => {
  const { db, call } = await setup();
  await Promise.all(Array.from({ length: 6 }, (_, w) => call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`,
    ops(...Array.from({ length: 25 }, (_, i): [string, string, string] => [stamp(NOW - 50_000 + w * 1000 + i), `h:w${w}k${i}`, 'completed'])))));
  const rows = db.sqlite.prepare('SELECT seq FROM v5_state ORDER BY seq').all() as { seq: number }[];
  assert.equal(rows.length, 150);
  assert.equal(new Set(rows.map((r) => r.seq)).size, 150, 'no duplicate sequence numbers');
  const counter = db.sqlite.prepare('SELECT seq FROM v5_counters').get() as { seq: number };
  assert.equal(rows[rows.length - 1].seq, counter.seq, 'the counter ends exactly at the highest assigned number');
});


test('a scoped editor cannot overwrite another team\u2019s progress by claiming their own area', async () => {
  const { db, call } = await setup();
  const url = `/api/v5/campaigns/${campaign}/ops`;
  await call('other', 'POST', url, ops([stamp(NOW - 5000), 'h:h777', 'completed', 'area_o']));
  const attack = await (await call('editor', 'POST', url, ops([stamp(NOW - 100), 'h:h777', 'not-deliverable', 'area_n'], [stamp(NOW - 99), 'h:h778', 'completed', 'area_n']))).json() as { accepted: string[]; rejected: { reason: string }[] };
  assert.deepEqual(attack.rejected.map((r) => r.reason), ['key_owned_elsewhere']);
  assert.equal(attack.accepted.length, 1, 'new keys in the editor\u2019s own area still work');
  const row = db.sqlite.prepare("SELECT status, area_id FROM v5_state WHERE key='h:h777'").get() as { status: string; area_id: string };
  assert.deepEqual([row.status, row.area_id], ['completed', 'area_o']);
  // The same team keeps editing its own keys; an admin may correct anything.
  await call('other', 'POST', url, ops([stamp(NOW - 50), 'h:h777', 'later', 'area_o']));
  assert.equal((db.sqlite.prepare("SELECT status FROM v5_state WHERE key='h:h777'").get() as { status: string }).status, 'later');
  await call('admin', 'POST', url, ops([stamp(NOW - 10), 'h:h777', 'open', 'area_n']));
  assert.equal((db.sqlite.prepare("SELECT status FROM v5_state WHERE key='h:h777'").get() as { status: string }).status, 'open');
});

test('the SQL guard also protects against a race that slips past the ownership pre-check', async () => {
  const { db, call } = await setup();
  await call('other', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 5000), 'h:h900', 'completed', 'area_o']));
  // Simulate the check-then-write race: the pre-check sees no owner, the row appears before the batch runs.
  const original = db.prepare.bind(db);
  let injected = false;
  (db as unknown as { prepare: typeof db.prepare }).prepare = (query: string) => {
    if (!injected && query.startsWith('SELECT key, area_id FROM v5_state')) {
      injected = true;
      const statement = original(query);
      return { bind: (...values: unknown[]) => { statement.bind(...values); return { bind: () => statement, first: async () => null, all: async () => ({ results: [] }) } as never; }, first: statement.first.bind(statement), all: statement.all.bind(statement) } as never;
    }
    return original(query);
  };
  await call('editor', 'POST', `/api/v5/campaigns/${campaign}/ops`, ops([stamp(NOW - 100), 'h:h900', 'not-deliverable', 'area_n']));
  assert.equal((db.sqlite.prepare("SELECT status FROM v5_state WHERE key='h:h900'").get() as { status: string }).status, 'completed');
});

test('a pack built for an old polygon is reported missing; unchanged packs revalidate with 304', async () => {
  const { db, call } = await setup();
  const fetchImpl = (async () => overpassOk()) as unknown as typeof fetch;
  await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl });
  const first = await call('viewer', 'GET', `/api/v5/campaigns/${campaign}/areas/area_n/pack`);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag')!;
  const revalidated = await handleV5Api(new Request(`https://example.test/api/v5/campaigns/${campaign}/areas/area_n/pack`, { headers: { 'if-none-match': etag, cookie: (await cookieFor(db)) } }), db);
  assert.equal(revalidated!.status, 304);
  db.sqlite.prepare('UPDATE areas SET geometry_json=? WHERE id=?').run(JSON.stringify({ type: 'Polygon', coordinates: [[[13, 51], [13.02, 51], [13.02, 51.01], [13, 51.01], [13, 51]]] }), 'area_n');
  const meta = await (await call('admin', 'GET', `/api/v5/campaigns/${campaign}/meta`)).json() as { areas: { id: string; packVersion: number | null; packStale: boolean }[] };
  const area = meta.areas.find((a) => a.id === 'area_n')!;
  assert.deepEqual([area.packVersion, area.packStale], [null, true]);
});

async function cookieFor(db: NetworkD1) {
  const { grant } = await createAccessGrant(db, { campaignId: campaign, role: 'viewer', teamId: null, label: 'v2' });
  const session = await createSessionForGrant(db, (await resolveAccessForGrant(db, grant.grantId))!);
  return sessionCookie(session.sessionSecret).split(';')[0];
}

test('concurrent pack builds: exactly one reaches the upstream, failures are throttled too', async () => {
  const { call } = await setup();
  let upstream = 0;
  const fetchImpl = (async () => { upstream++; await new Promise((r) => setTimeout(r, 10)); return overpassOk(); }) as unknown as typeof fetch;
  const results = await Promise.all([1, 2, 3].map(() => call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_n/pack`, undefined, { fetchImpl })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429, 429]);
  assert.equal(upstream, 1);
  const failing = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
  assert.equal((await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_o/pack`, undefined, { fetchImpl: failing })).status, 502);
  assert.equal((await call('admin', 'POST', `/api/v5/campaigns/${campaign}/areas/area_o/pack`, undefined, { fetchImpl: failing })).status, 429, 'a failed attempt still counts');
});

test('fuzz against the real handler and SQL: overlapping batches, duplicates and reordering always leave the highest op id per key', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    let s = seed;
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
    const { db, call } = await setup();
    const keys = Array.from({ length: 10 }, (_, i) => `h:f${i}`);
    const all: { id: string; key: string; status: string }[] = [];
    for (let i = 0; i < 90; i++) all.push({ id: stamp(NOW - 100_000 + Math.floor(rand() * 90_000), Math.floor(rand() * 5), `n${Math.floor(rand() * 4)}`), key: keys[Math.floor(rand() * keys.length)], status: ['completed', 'later', 'not-deliverable', 'open'][Math.floor(rand() * 4)] });
    const batches: typeof all[] = [];
    for (let i = 0; i < 40; i++) batches.push(Array.from({ length: 1 + Math.floor(rand() * 8) }, () => all[Math.floor(rand() * all.length)]));
    // every op is sent at least once; the order is shuffled and many are duplicated
    batches.push(all);
    for (let i = batches.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [batches[i], batches[j]] = [batches[j], batches[i]]; }
    await Promise.all(batches.map((batch) => call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, { ops: batch.map((o) => ({ ...o, area: 'area_n' })) })));
    for (const key of keys) {
      const best = all.filter((o) => o.key === key).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
      const row = db.sqlite.prepare('SELECT op_id, status FROM v5_state WHERE key=?').get(key) as { op_id: string; status: string } | undefined;
      assert.equal(row?.op_id, best?.id, `seed ${seed}: ${key}`);
      if (best) assert.equal(row?.status, best.status);
    }
    const seqs = (db.sqlite.prepare('SELECT seq FROM v5_state').all() as { seq: number }[]).map((r) => r.seq);
    assert.equal(new Set(seqs).size, seqs.length, `seed ${seed}: sequence numbers are unique`);
  }
});

import { deriveNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';

test('every key the engine can produce (chunks, nodes, houses, address nodes) is accepted by the server', async () => {
  const { call } = await setup();
  const net = deriveNetwork(syntheticCity(4, 3).raw);
  assert.ok(net.segments.some((s) => s.id.includes('~')), 'the fixture has chunk ids');
  const keys = [...net.segments.map((s) => `s:${s.id}`), ...net.houses.map((h) => `h:${h.id}`)].slice(0, 150);
  const res = await (await call('admin', 'POST', `/api/v5/campaigns/${campaign}/ops`, { ops: keys.map((key, i) => ({ id: stamp(NOW - 5000, i), key, status: 'completed', area: 'area_n' })) })).json() as { accepted: string[]; rejected: { reason: string }[] };
  assert.deepEqual(res.rejected, []);
  assert.equal(res.accepted.length, keys.length);
});
