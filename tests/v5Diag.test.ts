import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '../src/v5/diag/log.ts';
import { Histogram, Metrics } from '../src/v5/diag/metrics.ts';
import { redactText, redactValue } from '../src/v5/diag/redact.ts';
import { routeOf, tracedFetch } from '../src/v5/diag/net.ts';
import { buildReport, REPORT_SCHEMA } from '../src/v5/diag/report.ts';
import { collectProbes, registerProbe } from '../src/v5/diag/probes.ts';
import { log as globalLog, metrics as globalMetrics } from '../src/v5/diag/state.ts';

const TOKEN = 'a'.repeat(43);

test('redaction removes positions, credentials and token-like strings, and bounds size', () => {
  const out = redactValue({
    lat: 51.1, lng: 13.2, coordinates: [[13, 51]], center: [13, 51], position: { x: 1 }, token: TOKEN, cookie: 'vf_session=' + TOKEN, label: 'Max Mustermann', name: 'Gruppe Nord',
    ok: 'fine', n: 3, nested: { geometry: { type: 'Polygon' }, count: 2 }, url: `https://x.test/v5?campaign=c#access=${TOKEN}`, long: 'x'.repeat(1000), list: Array.from({ length: 50 }, (_, i) => i),
  }) as Record<string, unknown>;
  for (const key of ['lat', 'lng', 'coordinates', 'center', 'position', 'token', 'cookie', 'label', 'name']) assert.equal(out[key], '[removed]', key);
  assert.equal((out.nested as Record<string, unknown>).geometry, '[removed]');
  assert.equal((out.nested as Record<string, unknown>).count, 2);
  assert.equal(out.ok, 'fine'); assert.equal(out.n, 3);
  assert.ok(!String(out.url).includes(TOKEN) && String(out.url).includes('#access=[removed]'));
  assert.ok(String(out.long).length <= 301);
  assert.equal((out.list as unknown[]).length, 21, '20 items and a marker for the rest');
  assert.equal(JSON.stringify(out).includes(TOKEN), false);
  assert.equal(redactText(`Bearer ${TOKEN}`), 'Bearer [token]');
  const deep = redactValue({ a: { b: { c: { d: { e: 1 } } } } }) as Record<string, unknown>;
  assert.ok(JSON.stringify(deep).includes('[…]'), 'depth is bounded');
  const err = redactValue(new Error(`bad ${TOKEN}`)) as { message: string };
  assert.ok(!err.message.includes(TOKEN));
});

test('the log keeps warnings and errors when a burst of other lines evicts everything else', () => {
  const l = new Logger(20, 5);
  l.verbose = true;
  l.error('sync', 'the one that matters', { code: 1 });
  for (let i = 0; i < 200; i++) l.debug('net', `noise ${i}`);
  const all = l.entries();
  assert.ok(all.some((e) => e.msg === 'the one that matters'), 'sticky ring survived');
  assert.ok(all.length <= 20 + 5);
  assert.deepEqual(all.map((e) => e.seq), [...all.map((e) => e.seq)].sort((a, b) => a - b), 'ordered, no duplicates');
  assert.equal(new Set(all.map((e) => e.seq)).size, all.length);
  assert.equal(l.counts.error, 1); assert.equal(l.counts.debug, 200);
});

test('debug lines are dropped unless verbose; filters by level, category and text; clear resets', () => {
  const l = new Logger();
  l.debug('net', 'hidden'); assert.equal(l.entries().length, 0);
  l.verbose = true;
  l.debug('net', 'visible'); l.info('sync', 'push done', { sent: 3 }); l.warn('net', 'slow request'); l.error('engine', 'wasm failed');
  assert.equal(l.entries({ min: 'warn' }).length, 2);
  assert.deepEqual(l.entries({ cat: 'net' }).map((e) => e.msg), ['visible', 'slow request']);
  assert.deepEqual(l.entries({ text: 'sent' }).map((e) => e.msg), ['push done'], 'text searches the data too');
  assert.equal(l.entries({ limit: 1 }).length, 1);
  l.clear(); assert.equal(l.entries().length, 0); assert.equal(l.counts.warn, 0);
});

test('log data is redacted when recorded, so a later export cannot leak it', () => {
  const l = new Logger();
  l.warn('ui', `token ${TOKEN}`, { lat: 1, lng: 2, token: TOKEN, ms: 5 });
  const e = l.entries()[0];
  assert.ok(!JSON.stringify(e).includes(TOKEN));
  assert.deepEqual(e.data, { lat: '[removed]', lng: '[removed]', token: '[removed]', ms: 5 });
});

test('subscribers are told once per burst', async () => {
  const l = new Logger();
  let calls = 0;
  const off = l.subscribe(() => { calls++; });
  for (let i = 0; i < 10; i++) l.info('ui', 'x');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 1);
  off(); l.info('ui', 'y'); await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 1);
});

test('histograms: exact percentiles over the window, totals over all observations', () => {
  const h = new Histogram(100);
  for (let i = 1; i <= 100; i++) h.add(i);
  let s = h.stats();
  assert.deepEqual([s.n, s.min, s.max, s.p50, s.p95, s.p99, s.last], [100, 1, 100, 50, 95, 99, 100]);
  for (let i = 0; i < 100; i++) h.add(1000); // the window now holds only the new samples
  s = h.stats();
  assert.deepEqual([s.n, s.p50, s.max, s.min], [200, 1000, 1000, 1], 'window percentiles, lifetime min/max/n');
  h.add(NaN); h.add(Infinity);
  assert.equal(h.stats().n, 200, 'non-finite values are ignored');
});

test('metrics: counters, gauges, histograms, timers (also when the timed code throws)', async () => {
  const m = new Metrics();
  m.inc('a'); m.inc('a', 4); m.set('g', 7); m.set('g', 9); m.set('bad', NaN);
  assert.equal(m.counter('a'), 5); assert.equal(m.gauge('g'), 9); assert.equal(m.gauge('bad'), null); assert.equal(m.counter('none'), 0);
  assert.equal(await m.time('t', async () => 42), 42);
  await assert.rejects(m.time('t', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(m.hist('t')?.n, 2);
  const done = m.start('s'); assert.ok(done() >= 0); assert.equal(m.hist('s')?.n, 1);
  const snap = m.snapshot();
  assert.deepEqual(Object.keys(snap.counters), ['a']);
  assert.equal(m.histograms('t').length, 1);
  m.reset(); assert.equal(m.counter('a'), 0);
});

test('route templates carry no ids and no query', () => {
  assert.equal(routeOf('get', '/api/v5/campaigns/campaign_abc123XYZ/state?since=5&limit=1000'), 'GET /api/v5/campaigns/:c/state');
  assert.equal(routeOf('POST', '/api/v5/campaigns/c1/areas/area_9f8e7d6c5b/pack'), 'POST /api/v5/campaigns/:c/areas/:a/pack');
  assert.equal(routeOf('POST', '/api/campaigns/c1/collection/collectors/collector_1234567890/pickup-capabilities'), 'POST /api/campaigns/:c/collection/collectors/:id/pickup-capabilities');
  assert.equal(routeOf('GET', 'https://example.test/api/v5/basemap'), 'GET /api/v5/basemap');
});

test('the traced fetch sends a request id, counts outcomes and logs failures without ids', async () => {
  const seen: string[] = [];
  const real = globalThis.fetch;
  let mode: 'ok' | 'err' | 'throw' = 'ok';
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('x-request-id') ?? '');
    if (mode === 'throw') throw new TypeError('Failed to fetch');
    return new Response('{}', { status: mode === 'ok' ? 200 : 500, headers: { 'x-request-id': 'srv-1' } });
  }) as typeof fetch;
  try {
    globalMetrics.reset(); globalLog.clear();
    await tracedFetch('/api/v5/campaigns/campaign_secret_123456/meta');
    mode = 'err'; await tracedFetch('/api/v5/campaigns/campaign_secret_123456/meta');
    mode = 'throw'; await assert.rejects(tracedFetch('/api/v5/campaigns/campaign_secret_123456/meta'), /Failed to fetch/);
  } finally { globalThis.fetch = real; }
  assert.ok(seen.every((id) => /^c-[a-z0-9]{6,}$/.test(id)));
  assert.equal(globalMetrics.counter('net.requests'), 3);
  assert.equal(globalMetrics.counter('net.GET /api/v5/campaigns/:c/meta.status.2xx'), 1);
  assert.equal(globalMetrics.counter('net.GET /api/v5/campaigns/:c/meta.status.5xx'), 1);
  assert.equal(globalMetrics.counter('net.GET /api/v5/campaigns/:c/meta.failed'), 1);
  assert.equal(globalMetrics.gauge('net.inflight'), 0);
  const entries = globalLog.entries({ min: 'warn' });
  assert.equal(entries.length, 2);
  assert.ok(!JSON.stringify(entries).includes('campaign_secret'), 'no campaign id in the log');
});

test('probes describe subsystems on demand and a failing probe never breaks the report', () => {
  const off = registerProbe('good', () => ({ n: 1, lat: 5 }));
  registerProbe('bad', () => { throw new Error('probe broke'); });
  const out = collectProbes();
  assert.deepEqual(out.good, { n: 1, lat: '[removed]' });
  assert.deepEqual(out.bad, { error: 'probe broke' });
  off();
  assert.equal(collectProbes().good, undefined);
});

test('the report has the documented shape and contains nothing token-like', () => {
  globalMetrics.reset(); globalLog.clear(); globalLog.verbose = true;
  globalMetrics.observe('engine.area.ms', 12); globalMetrics.inc('sync.pushed', 3);
  globalLog.warn('sync', `failed with ${TOKEN}`, { token: TOKEN, ok: true });
  registerProbe('leak', () => ({ secret: TOKEN, text: `x ${TOKEN}` }));
  const r = buildReport({ id: 's1', startedAt: Date.now() - 5000, bootCount: 2, previous: { session: 's0', endedAt: Date.now() - 9000, entries: [{ seq: 1, t: 1, at: 1, lvl: 'error', cat: 'error', msg: `old ${TOKEN}`, prev: true }] } });
  assert.equal(r.schema, REPORT_SCHEMA);
  assert.deepEqual(Object.keys(r).sort(), ['device', 'flags', 'generatedAt', 'log', 'metrics', 'previousSession', 'run', 'schema', 'subsystems']);
  assert.equal(r.run.bootCount, 2);
  assert.equal(r.metrics.counters['sync.pushed'], 3);
  assert.equal(r.metrics.histograms['engine.area.ms'].n, 1);
  assert.equal(r.log.entries.length, 1);
  assert.equal(r.previousSession?.entries.length, 1);
  assert.equal(JSON.stringify(r).includes(TOKEN), false);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
  globalLog.verbose = false;
});

import { findings } from '../src/v5/diag/findings.ts';
const base = () => ({ metrics: { since: 0, counters: {} as Record<string, number>, gauges: {} as Record<string, number>, histograms: {} as Record<string, never> }, subsystems: {} as Record<string, unknown> });

test('findings: a healthy device says so; every rule fires on its own condition and in order of importance', () => {
  assert.deepEqual(findings(base()).map((f) => f.level), ['ok']);

  const bad = base();
  bad.metrics.counters = { 'idb.failed.idb save all': 2, 'errors.window': 1, 'net.requests': 10, 'net.failed': 5, 'map.styleFallback': 1, 'store.conflicts': 2 };
  bad.metrics.gauges = { 'engine.wasm': 0, 'net.online': 0, 'render.fps': 12, 'mem.heapMb': 900, 'mem.heapLimitMb': 1000, 'storage.usageMb': 95, 'storage.quotaMb': 100 };
  bad.subsystems = { engine: { initError: 'Failed to fetch' }, sync: { failures: 3, backoffMs: 4000, lastError: 'Serverfehler 500', pendingOps: 4, lastOkAgoS: 400 }, campaign: { store: { clockOffsetMs: 9000 } } };
  const list = findings(bad);
  const order = list.map((f) => f.level);
  assert.deepEqual(order, [...order].sort((a, b) => ['error', 'warn', 'info', 'ok'].indexOf(a) - ['error', 'warn', 'info', 'ok'].indexOf(b)), 'errors first, then warnings, then notes');
  const text = list.map((f) => f.text).join('\n');
  for (const needle of ['Lokales Speichern', 'unerwartete Fehler', 'TypeScript-Engine', 'Failed to fetch', 'Serverfehler 500', 'Uhr des Geräts', '95 %', '12 Bildern', '90 %', 'fehlgeschlagen', 'offline', 'Grundkarte', 'ersetzt']) assert.ok(text.includes(needle), needle);
  assert.ok(!list.some((f) => f.level === 'ok'));

  // online with queued edits and no failures: stuck outbox
  const stuck = base(); stuck.metrics.gauges = { 'net.online': 1 }; stuck.subsystems = { sync: { failures: 0, pendingOps: 3, lastOkAgoS: 300 } };
  assert.ok(findings(stuck).some((f) => /warten seit über 2 Minuten/.test(f.text)));
  // offline with queued edits is not "stuck", it is expected
  const off = base(); off.metrics.gauges = { 'net.online': 0 }; off.subsystems = { sync: { failures: 0, pendingOps: 3, lastOkAgoS: 300 } };
  assert.ok(!findings(off).some((f) => /warten seit über 2 Minuten/.test(f.text)));
});
