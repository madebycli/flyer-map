import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';
import { createAccessGrant, createSessionForGrant, sessionCookie } from '../worker/access.ts';
import { handleV5Api } from '../worker/v5/api.ts';
import { v5OptionsFromEnv } from '../worker/v5/config.ts';
import { instrumentDb, logLevelFrom, requestIdOf } from '../worker/v5/observe.ts';

const campaign = 'campaign_n';
const NOW = 1_800_000_000_000;

async function setup() {
  const db = new NetworkD1(false, true);
  seedNetwork(db);
  const { grant } = await createAccessGrant(db, { campaignId: campaign, role: 'admin', teamId: null, label: 'Geheimer Name' });
  const session = await createSessionForGrant(db, { grantId: grant.grantId, campaignId: campaign, role: 'admin', teamId: null, label: null });
  const cookie = sessionCookie(session.sessionSecret).split(';')[0];
  const lines: { level: string; text: string }[] = [];
  const call = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; auth?: boolean; level?: 'debug' | 'info' | 'warn' | 'error' } = {}) => {
    const request = new Request(`https://example.test${path}`, { method: init.method ?? 'GET', headers: { ...(init.auth === false ? {} : { cookie }), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers }, body: init.body ? JSON.stringify(init.body) : undefined });
    return (await handleV5Api(request, db, { now: () => NOW, logLevel: init.level, logSink: (level, text) => lines.push({ level, text }) }))!;
  };
  return { call, lines, cookie, session };
}

test('the server echoes a well-formed request id, makes one otherwise, and never takes a malformed one into a header or a log line', async () => {
  const { call, lines } = await setup();
  assert.equal((await call(`/api/v5/campaigns/${campaign}/state?since=0`, { headers: { 'x-request-id': 'c-abc12345' } })).headers.get('x-request-id'), 'c-abc12345');
  const made = (await call(`/api/v5/campaigns/${campaign}/state?since=0`)).headers.get('x-request-id');
  assert.match(made ?? '', /^s-[0-9a-f-]{12}$/);
  const evil = (await call(`/api/v5/campaigns/${campaign}/state?since=0`, { headers: { 'x-request-id': 'bad id with spaces <script>' }, level: 'debug' })).headers.get('x-request-id');
  assert.match(evil ?? '', /^s-/);
  assert.ok(lines.every((l) => !l.text.includes('script')));
  assert.match(requestIdOf(new Request('https://x.test', { headers: { 'x-request-id': 'x'.repeat(41) } })), /^s-/);
});

test('Server-Timing reports total and database time with the query count', async () => {
  const { call } = await setup();
  const response = await call(`/api/v5/campaigns/${campaign}/state?since=0`);
  const timing = response.headers.get('server-timing') ?? '';
  assert.match(timing, /^total;dur=[\d.]+, db;dur=[\d.]+;desc="\d+ queries/);
  assert.ok(Number(/desc="(\d+) queries/.exec(timing)?.[1]) >= 1, timing);
  assert.equal(response.status, 200);
});

test('by default only problems are logged; info shows every request; lines carry route template, status, timing and an error code, nothing else', async () => {
  const { call, lines, cookie } = await setup();
  await call(`/api/v5/campaigns/${campaign}/state?since=0`);
  assert.equal(lines.length, 0, 'a healthy request is silent at the default level');
  await call(`/api/v5/campaigns/${campaign}/state?since=0`, { level: 'info' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  await call(`/api/v5/campaigns/${campaign}/state?since=0`, { auth: false });
  const denied = lines.at(-1)!;
  assert.equal(denied.level, 'warn');
  const parsed = JSON.parse(denied.text);
  assert.equal(parsed.status, 401);
  assert.equal(parsed.code, 'unauthorized');
  assert.equal(parsed.route, '/api/v5/campaigns/:c/state');
  assert.deepEqual(Object.keys(parsed).sort(), ['code', 'db', 'lvl', 'method', 'ms', 'msg', 'rid', 'route', 'status']);
  const all = lines.map((l) => l.text).join('\n');
  for (const secret of [campaign, 'since=0', 'Geheimer Name', cookie.split('=')[1]]) assert.ok(!all.includes(secret), `the log must not contain ${secret}`);
});

test('a 500 is an error line with the error name only, and the exception still propagates', async () => {
  const lines: { level: string; text: string }[] = [];
  const db = new NetworkD1(false, true); seedNetwork(db);
  const broken = { prepare: () => { throw new TypeError('secret detail campaign_n'); }, batch: async () => [] };
  await assert.rejects(handleV5Api(new Request(`https://example.test/api/v5/campaigns/${campaign}/state`, { headers: { cookie: 'vf_session=x' } }), broken as never, { logSink: (level, text) => lines.push({ level, text }) }), /secret detail/);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'error');
  assert.equal(JSON.parse(lines[0].text).code, 'TypeError');
  assert.ok(!lines[0].text.includes('secret detail') && !lines[0].text.includes(campaign));
});

test('the instrumented database counts queries and batches and keeps D1 semantics', async () => {
  const db = new NetworkD1(false, true); seedNetwork(db);
  const { db: wrapped, stats } = instrumentDb(db);
  const row = await wrapped.prepare('SELECT id FROM campaigns WHERE id = ?').bind(campaign).first<{ id: string }>();
  assert.equal(row?.id, campaign);
  const rows = await wrapped.prepare('SELECT id FROM teams WHERE campaign_id = ?').bind(campaign).all<{ id: string }>();
  assert.ok(rows.results.length >= 1);
  const t = '2026-09-07T00:00:00.000Z';
  await wrapped.batch([wrapped.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_x',?,'X','#fff',?,?)").bind(campaign, t, t)]);
  assert.equal(stats.queries, 3);
  assert.equal(stats.batches, 1);
  assert.equal((db.sqlite.prepare("SELECT COUNT(*) AS n FROM teams WHERE id='team_x'").get() as { n: number }).n, 1, 'the batch reached the real database');
});

test('the log level comes from V5_LOG_LEVEL, unknown values fall back to warn', () => {
  assert.equal(logLevelFrom(undefined), 'warn');
  assert.equal(logLevelFrom(' INFO '), 'info');
  assert.equal(logLevelFrom('verbose'), 'warn');
  assert.equal(v5OptionsFromEnv({ V5_LOG_LEVEL: 'debug' }).logLevel, 'debug');
  assert.equal(v5OptionsFromEnv({}).logLevel, 'warn');
});

test('first(columnName) and run/raw receive their arguments through the wrapper', async () => {
  const seen: unknown[][] = [];
  const fake = { prepare: () => { const st: Record<string, unknown> = { bind: () => st, first: async (...a: unknown[]) => { seen.push(['first', ...a]); return a.length ? 3 : { count: 3 }; }, all: async () => ({ results: [] }), run: async () => ({ success: true }), raw: async (...a: unknown[]) => { seen.push(['raw', ...a]); return []; } }; return st; }, batch: async () => [] };
  const { db } = instrumentDb(fake as never);
  const st = db.prepare('x') as unknown as { first(c?: string): Promise<unknown>; raw(o: unknown): Promise<unknown> };
  assert.equal(await st.first('count'), 3);
  assert.deepEqual(await st.first(), { count: 3 });
  await st.raw({ columnNames: true });
  assert.deepEqual(seen, [['first', 'count'], ['first'], ['raw', { columnNames: true }]]);
});
