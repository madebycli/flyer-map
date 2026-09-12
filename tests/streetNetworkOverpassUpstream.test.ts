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

test('building preparation skips one open OSM building instead of aborting the tile', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  let buildingQuery = false;

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (_input, init) => {
      const query = decodeURIComponent(String(init?.body ?? '')).replaceAll('+', ' ');
      if (query.includes('way["building"]')) {
        buildingQuery = true;
        const response = networkOsm();
        const payload = await response.json() as { elements: unknown[] };
        payload.elements.push({
          type: 'way',
          id: 999,
          tags: { building: 'yes' },
          geometry: [{ lon: 13.003, lat: 51.006 }, { lon: 13.004, lat: 51.006 }],
        });
        return new Response(JSON.stringify(payload));
      }
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.equal(buildingQuery, true);
  assert.equal(result.houseCount, 3);
});

test('default Overpass preparation fails over when the primary returns a partial building response', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      return url === primary
        ? new Response(JSON.stringify({ remark: 'runtime error', elements: [] }))
        : networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.deepEqual([...new Set(urls)], [primary, fallback]);
});

test('default Overpass preparation fails over when fetch throws a transport error', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === primary) throw new TypeError('fetch failed');
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.deepEqual([...new Set(urls)], [primary, fallback]);
});

test('default Overpass preparation gives the fallback a fresh timeout after the primary times out', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    limits: { timeoutMs: 5 },
    fetchImpl: async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url === fallback) return networkOsm();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
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
    assert.equal(job.attempts, 0);
    assert.equal(job.error_code, null);
  });
}

test('explicit Overpass upstream retries a thrown transport error through the existing backoff', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const custom = 'https://example.test/overpass';
  let calls = 0;
  let clock = Date.parse('2026-09-08T20:00:00.000Z');

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    upstreamUrl: custom,
    now: () => new Date(clock += 5_000),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.ok(calls >= 3);
  const job = db.sqlite.prepare('SELECT attempts,error_code,metrics_json FROM street_network_jobs').get() as { attempts: number; error_code: string | null; metrics_json: string };
  assert.equal(job.attempts, 0);
  assert.equal(job.error_code, null);
  assert.ok((JSON.parse(job.metrics_json).retries ?? 0) >= 1);
});
