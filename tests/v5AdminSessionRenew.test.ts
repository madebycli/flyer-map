import test from 'node:test';
import assert from 'node:assert/strict';
import { call, V5ApiError } from '../src/v5/app/api.ts';
import { campaignOfPath, resetAdminSessionRenewal } from '../src/v5/app/session.ts';

type Reply = { status: number; body?: unknown };
function stub(script: (url: string, count: number) => Reply) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    seen.push(url);
    const reply = script(url, seen.filter((u) => u === url).length);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

test('campaignOfPath reads the Aktion of a v5 path', () => {
  assert.equal(campaignOfPath('/api/v5/campaigns/campaign_a%20b/meta'), 'campaign_a b');
  assert.equal(campaignOfPath('/api/v5/basemap'), null);
  assert.equal(campaignOfPath('/api/organization/me'), null);
});

test('an expired admin session is renewed from the remembered device and the request goes again once', async () => {
  resetAdminSessionRenewal();
  const meta = '/api/v5/campaigns/c1/meta';
  const s = stub((url, n) => url === meta ? (n === 1 ? { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } } : { status: 200 }) : { status: 200 });
  try {
    const response = await call(meta);
    assert.equal(response.status, 200);
    assert.deepEqual(s.seen, [meta, '/api/organization/session/refresh', meta]);
  } finally { s.restore(); }
});

test('the campaign admin device is tried when the organiser one is gone', async () => {
  resetAdminSessionRenewal();
  const meta = '/api/v5/campaigns/c1/meta';
  const s = stub((url, n) => url === meta ? (n === 1 ? { status: 401 } : { status: 200 }) : url === '/api/organization/session/refresh' ? { status: 401 } : { status: 200 });
  try {
    assert.equal((await call(meta)).status, 200);
    assert.deepEqual(s.seen, [meta, '/api/organization/session/refresh', '/api/campaigns/c1/admin-accounts/session/refresh', meta]);
  } finally { s.restore(); }
});

test('a link without a remembered device fails with 401 after one renewal try, and is not asked again for a minute', async () => {
  resetAdminSessionRenewal();
  const meta = '/api/v5/campaigns/c1/meta';
  const s = stub(() => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Kein Zugriff auf diese Aktion.' } } }));
  try {
    await assert.rejects(() => call(meta), (error: unknown) => error instanceof V5ApiError && error.status === 401);
    const first = s.seen.length;
    await assert.rejects(() => call(meta), (error: unknown) => error instanceof V5ApiError && error.status === 401);
    assert.equal(s.seen.length - first, 1, 'the second call does not try to renew again');
  } finally { s.restore(); }
});

test('parallel 401s share one renewal', async () => {
  resetAdminSessionRenewal();
  const a = '/api/v5/campaigns/c1/meta', b = '/api/v5/campaigns/c1/state';
  const s = stub((url, n) => url === a || url === b ? (n === 1 ? { status: 401 } : { status: 200 }) : { status: 200 });
  try {
    await Promise.all([call(a), call(b)]);
    assert.equal(s.seen.filter((u) => u === '/api/organization/session/refresh').length, 1);
  } finally { s.restore(); }
});

test('other errors are not retried', async () => {
  resetAdminSessionRenewal();
  const s = stub(() => ({ status: 403 }));
  try {
    await assert.rejects(() => call('/api/v5/campaigns/c1/ops', { method: 'POST' }), (error: unknown) => error instanceof V5ApiError && error.status === 403);
    assert.equal(s.seen.length, 1);
  } finally { s.restore(); }
});
