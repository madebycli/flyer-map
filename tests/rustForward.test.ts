import assert from 'node:assert/strict';
import test from 'node:test';
import mainWorker from '../worker/indexOrganizer.ts';
import { forwardToRust, rustGroups, rustOwns } from '../worker/rustForward.ts';

const answering = (calls: Request[]) => ({ fetch: async (request: Request) => { calls.push(request); return Response.json({ from: 'rust' }); } });
const broken = (calls: Request[]) => ({ fetch: async (request: Request) => { calls.push(request); throw new TypeError('binding down'); } });

test('only named, known groups are handed over', () => {
  assert.deepEqual(rustGroups(' v5 , nope,,'), ['v5']);
  assert.equal(rustOwns('/api/v5/campaigns/c/state', 'v5'), true);
  assert.equal(rustOwns('/api/v5/campaigns/c/state', ''), false);
  assert.equal(rustOwns('/api/v5/campaigns/c/state', undefined), false);
  assert.equal(rustOwns('/api/access/current', 'v5'), false);
  assert.equal(rustOwns('/api/v50/x', 'v5'), false);
});

test('without the binding or the group nothing is handed over', async () => {
  const calls: Request[] = [];
  assert.equal(await forwardToRust(new Request('https://x.test/api/v5/basemap'), { RUST_ROUTES: 'v5' }), null);
  assert.equal(await forwardToRust(new Request('https://x.test/api/v5/basemap'), { RUST_API: answering(calls) }), null);
  assert.equal(calls.length, 0);
});

test('a failing hand-over leaves the request intact for this Worker', async () => {
  const calls: Request[] = [];
  const reasons: string[] = [];
  const request = new Request('https://x.test/api/v5/campaigns/c/ops', { method: 'POST', body: '{"ops":[]}', headers: { 'content-type': 'application/json' } });
  assert.equal(await forwardToRust(request, { RUST_API: broken(calls), RUST_ROUTES: 'v5' }, (r) => reasons.push(r)), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(reasons, ['TypeError']);
  assert.equal(await request.text(), '{"ops":[]}');
});

test('the main Worker hands v5 over and hardens the answer; everything else stays', async () => {
  const calls: Request[] = [];
  const env = { RUST_API: answering(calls), RUST_ROUTES: 'v5' } as never;
  const handed = await mainWorker.fetch(new Request('https://x.test/api/v5/basemap'), env);
  assert.deepEqual(await handed.json(), { from: 'rust' });
  assert.equal(handed.headers.get('x-frame-options'), 'DENY');
  assert.equal(handed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/api/v5/basemap');
  const runtime = await mainWorker.fetch(new Request('https://x.test/api/runtime'), env);
  assert.equal(runtime.status, 200);
  assert.equal(calls.length, 1);
});

test('the main Worker answers itself when the Rust Worker cannot be reached', async () => {
  const calls: Request[] = [];
  const response = await mainWorker.fetch(new Request('https://x.test/api/v5/basemap'), { RUST_API: broken(calls), RUST_ROUTES: 'v5' } as never);
  assert.equal(calls.length, 1);
  assert.notDeepEqual(await response.json().catch(() => null), { from: 'rust' });
});
