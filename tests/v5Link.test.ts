import assert from 'node:assert/strict';
import test from 'node:test';
import { linkFor, linkIntent, redeemLink, toFieldMap } from '../src/v5/app/link.ts';

const T32 = 'a'.repeat(32), T64 = 'b'.repeat(64);

test('a token in the fragment is recognised by kind and plausible length only', () => {
  assert.deepEqual(linkIntent(`#access=${T32}`), { kind: 'access', token: T32 });
  assert.deepEqual(linkIntent(`#collection=${T64}`), { kind: 'collection', token: T64 });
  assert.equal(linkIntent('#access=short'), null);
  assert.equal(linkIntent(`#collection=${T32}`), null, 'collection tokens are longer');
  assert.equal(linkIntent(`#access=${'x'.repeat(300)}`), null);
  assert.equal(linkIntent(''), null);
  assert.equal(linkIntent('#other=1'), null);
});

test('redeeming posts the token to the right endpoint and tells apart refused, unreachable and fine', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const reply = (status: number) => (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}', { status }); }) as unknown as typeof fetch;
  assert.equal(await redeemLink('c1', { kind: 'access', token: T32 }, reply(200)), 'ok');
  assert.equal(await redeemLink('c1', { kind: 'collection', token: T64 }, reply(200)), 'ok');
  assert.equal(calls[0].url, '/api/access/redeem');
  assert.equal(calls[1].url, '/api/collection/access/redeem');
  assert.deepEqual(calls[0].body, { campaignId: 'c1', token: T32 });
  assert.equal(await redeemLink('c1', { kind: 'access', token: T32 }, reply(401)), 'invalid', 'revoked or wrong: ask for a new link');
  assert.equal(await redeemLink('c1', { kind: 'access', token: T32 }, reply(503)), 'offline', 'server trouble is not a verdict on the link');
  assert.equal(await redeemLink('c1', { kind: 'access', token: T32 }, reply(429)), 'offline');
  assert.equal(await redeemLink('c1', { kind: 'access', token: T32 }, (async () => { throw new TypeError('network'); }) as unknown as typeof fetch), 'offline');
});

test('old map links open the field map and keep their token', () => {
  assert.equal(toFieldMap(new URL(`https://x.test/?campaign=c1#access=${T32}`)), `/v5?campaign=c1#access=${T32}`);
  assert.equal(toFieldMap(new URL(`https://x.test/?campaign=c1&collection=1#collection=${T64}`)), `/v5?campaign=c1&kind=collection#collection=${T64}`);
  assert.equal(toFieldMap(new URL(`https://x.test/?campaign=c1#collection=${T64}`)), `/v5?campaign=c1&kind=collection#collection=${T64}`, 'the token alone marks a helper link');
  assert.equal(toFieldMap(new URL('https://x.test/?workbench=ui')), null, 'no campaign, nothing to open');
  assert.equal(toFieldMap(new URL('https://x.test/admin?campaign=c1')), null, 'only the map address is redirected');
  assert.equal(toFieldMap(new URL('https://x.test/?campaign=c1&evil=https://bad.test')), '/v5?campaign=c1', 'nothing but the campaign survives');
});

test('links handed to people point at the field map with the token in the fragment', () => {
  assert.equal(linkFor('https://x.test', 'c1', { kind: 'access', token: T32 }), `https://x.test/v5?campaign=c1#access=${T32}`);
  assert.equal(linkFor('https://x.test', 'c1', { kind: 'collection', token: T64 }), `https://x.test/v5?campaign=c1&kind=collection#collection=${T64}`);
  assert.equal(toFieldMap(new URL(linkFor('https://x.test', 'c 1', { kind: 'access', token: T32 }))), null, 'a v5 link is not redirected again');
});
