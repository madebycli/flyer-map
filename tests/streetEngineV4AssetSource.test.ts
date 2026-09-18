import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStreetEngineV4AssetBucket,
  streetEngineV4AssetPath,
  type StreetEngineV4AssetFetcher,
} from '../worker/streetNetwork/v4AssetSource.ts';

function fetcher(entries: Record<string, string | Uint8Array>): StreetEngineV4AssetFetcher {
  return {
    async fetch(input) {
      const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
      const path = new URL(rawUrl).pathname;
      const value = entries[path];
      if (value === undefined) return new Response('missing', { status: 404 });
      return new Response(value);
    },
  };
}

test('V4 Worker asset source maps immutable object keys without external fetches', async () => {
  const bucket = createStreetEngineV4AssetBucket(fetcher({
    '/__street-engine-v4/source/v1/channels/beta.json': '{"schemaVersion":1}',
    '/__street-engine-v4/source/v1/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin': new Uint8Array([1, 2, 3]),
  }));
  assert.ok(bucket);
  assert.equal(
    await (await bucket!.get('source/v1/channels/beta.json'))!.text(),
    '{"schemaVersion":1}',
  );
  assert.deepEqual(
    new Uint8Array(await (await bucket!.get('source/v1/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin'))!.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
  assert.equal(await bucket!.get('source/v1/channels/missing.json'), null);
});

test('V4 Worker asset source rejects traversal and malformed keys', () => {
  assert.equal(streetEngineV4AssetPath('source/v1/channels/beta.json'), '/__street-engine-v4/source/v1/channels/beta.json');
  assert.throws(() => streetEngineV4AssetPath('../secret'), /street_engine_v4_asset_key_invalid/u);
  assert.throws(() => streetEngineV4AssetPath('/source/v1/x'), /street_engine_v4_asset_key_invalid/u);
  assert.throws(() => streetEngineV4AssetPath('source//v1/x'), /street_engine_v4_asset_key_invalid/u);
});

test('V4 Worker asset source fails closed on non-404 asset errors', async () => {
  const bucket = createStreetEngineV4AssetBucket({
    fetch: async () => new Response('broken', { status: 503 }),
  });
  await assert.rejects(bucket!.get('source/v1/channels/beta.json'), /street_engine_v4_asset_read_failed/u);
});
