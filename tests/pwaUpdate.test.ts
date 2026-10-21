import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLatest, isNewer, versionLabel, type Latest } from '../src/pwa/version.ts';
import { coldStartUpdate, LONG_AWAY_MS, reloadOnce, updateAvailable, watchUpdates, type UpdateDeps } from '../src/pwa/update.ts';

const at = (build: number): Latest => ({ version: `5.7.${build}`, build: String(build), sha: 'abc1234' });
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const deps = (over: Partial<UpdateDeps> & { latest?: Latest | null }): UpdateDeps & { reloads: number } => {
  const d = { reloads: 0 } as UpdateDeps & { reloads: number };
  Object.assign(d, { fetchLatest: async () => (over.latest === undefined ? at(502) : over.latest), reload: () => { d.reloads++; }, storage: memory(), current: at(501) }, over);
  return d;
};

test('isNewer: only a higher real build number counts', () => {
  assert.equal(isNewer(at(502), at(501)), true);
  assert.equal(isNewer(at(501), at(501)), false);
  assert.equal(isNewer(at(500), at(501)), false, 'an older deploy never moves a device back');
  assert.equal(isNewer(at(502), { version: 'dev', build: '0', sha: '' }), false, 'a development build is never updated');
  assert.equal(isNewer({ version: 'x', build: 'abc', sha: '' }, at(501)), false);
  assert.equal(versionLabel(at(501)), 'v5.7.501');
  assert.equal(versionLabel({ version: 'dev', build: '0', sha: '' }), 'Entwicklung');
});

test('fetchLatest reads /version.json and rejects anything that is not a build', async () => {
  const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
  assert.deepEqual(await fetchLatest(500, reply({ version: '5.7.9', build: '9', sha: 'a' })), { version: '5.7.9', build: '9', sha: 'a' });
  assert.equal(await fetchLatest(500, reply({ version: '5.7.9', build: 'nine' })), null);
  assert.equal(await fetchLatest(500, reply({}, false)), null);
  assert.equal(await fetchLatest(500, (async () => { throw new Error('offline'); }) as unknown as typeof fetch), null);
  const slow = ((_: unknown, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
  assert.equal(await fetchLatest(30, slow), null, 'a slow server is given up on');
});

test('cold start: a newer build reloads once, then never again for that build in this session', async () => {
  const d = deps({});
  assert.equal(await coldStartUpdate(200, d), true);
  assert.equal(d.reloads, 1);
  assert.equal(await coldStartUpdate(200, d), false, 'the second start in the same session does not loop');
  assert.equal(d.reloads, 1);
  const newer = deps({ storage: d.storage, latest: at(503) });
  assert.equal(await coldStartUpdate(200, newer), true, 'a still newer build gets its own try');
});

test('cold start: same build, offline or slow server just starts the app', async () => {
  assert.equal(await coldStartUpdate(100, deps({ latest: at(501) })), false);
  assert.equal(await coldStartUpdate(100, deps({ latest: null })), false);
  const slow = deps({ fetchLatest: () => new Promise(() => {}) });
  const t = Date.now();
  assert.equal(await coldStartUpdate(80, slow), false);
  assert.ok(Date.now() - t < 500, 'the start waits only a moment');
  assert.equal(slow.reloads, 0);
});

test('reloadOnce does not reload without storage (a loop could not be stopped)', () => {
  const d = deps({ storage: null });
  assert.equal(reloadOnce(at(502), d), false);
  assert.equal(d.reloads, 0);
});

function fakeDoc() {
  let handler: (() => void) | null = null;
  const doc = { hidden: false, addEventListener: (_: string, h: () => void) => { handler = h; }, removeEventListener: () => { handler = null; } };
  return { doc: doc as unknown as Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'>, set hidden(v: boolean) { doc.hidden = v; handler?.(); } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('running app: a newer build is announced, a short pause only shows the banner, a long pause reloads', async () => {
  const d = deps({});
  const f = fakeDoc();
  let clock = 1_000_000;
  const watch = watchUpdates(d, f.doc, () => clock);
  await settle();
  assert.equal(updateAvailable()?.build, '502', 'the banner has its build');
  assert.equal(d.reloads, 0, 'nothing reloads while the app is in use');
  f.hidden = true; clock += 60_000; f.hidden = false;
  await settle();
  assert.equal(d.reloads, 0, 'one minute away: still the banner only');
  f.hidden = true; clock += LONG_AWAY_MS + 1; f.hidden = false;
  await settle();
  assert.equal(d.reloads, 1, 'half an hour away counts as a start');
  watch.stop();
});
