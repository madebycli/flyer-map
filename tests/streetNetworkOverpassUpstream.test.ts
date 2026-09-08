import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

const primary = 'https://overpass.private.coffee/api/interpreter';
const fallback = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

test('street preparation uses the primary live-compatible default Overpass upstream', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      urls.push(String(input));
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.ok(urls.length > 0);
  assert.deepEqual([...new Set(urls)], [primary]);
});

test('default Overpass preparation fails over when the primary is rate limited', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      return url === primary ? new Response('', { status: 429 }) : networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.deepEqual([...new Set(urls)], [primary, fallback]);
});

for (const status of [429, 521]) {
  test(`explicit Overpass upstream keeps transient HTTP ${status} pending until backoff permits retry`, async () => {
    const db = new NetworkD1();
    seedNetwork(db);
    const custom = 'https://example.test/overpass';
    const urls: string[] = [];
    let calls = 0;
    let clock = Date.parse('2026-09-08T20:00:00.000Z');

    const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
      upstreamUrl: custom,
      now: () => new Date(clock += 5_000),
      fetchImpl: async (input) => {
        urls.push(String(input));
        calls += 1;
        return calls === 1 ? new Response('', { status }) : networkOsm();
      },
    });

    assert.equal(result.outcome, 'ready');
    assert.ok(calls >= 3);
    assert.deepEqual([...new Set(urls)], [custom]);
    const job = db.sqlite.prepare('SELECT attempts,error_code FROM street_network_jobs').get() as { attempts: number; error_code: string | null };
    assert.equal(job.attempts, 1);
    assert.equal(job.error_code, null);
  });
}
