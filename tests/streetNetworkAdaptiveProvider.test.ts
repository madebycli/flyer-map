import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

const primary = 'https://overpass.private.coffee/api/interpreter';
const fallback = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

function seedMultiTileArea(db: NetworkD1) {
  const area = {
    type: 'Polygon',
    coordinates: [[[13, 51], [13.02, 51], [13.02, 51.01], [13, 51.01], [13, 51]]],
  };
  db.sqlite.prepare("UPDATE areas SET geometry_json=? WHERE id='area_n'").run(JSON.stringify(area));
}

test('default Overpass keeps the successful fallback preferred for later tiles in the same generation', async (t) => {
  const db = new NetworkD1();
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  seedMultiTileArea(db);
  const urls: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      return url === primary ? new Response('', { status: 504 }) : networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.equal(urls.filter((url) => url === primary).length, 1, 'the failed primary is paid only once');
  assert.ok(urls.filter((url) => url === fallback).length >= 4, 'later road/building tiles stay on the working fallback');
  assert.deepEqual(urls.slice(0, 3), [primary, fallback, fallback]);

  const row = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(row.metrics_json) as { preferredOverpassUrl?: string; requests?: number };
  assert.equal(metrics.preferredOverpassUrl, fallback);
  assert.equal(metrics.requests, urls.length);
});

test('adaptive preference can fail back to the other default provider without parallel requests', async (t) => {
  const db = new NetworkD1();
  t.after(() => db.sqlite.close());
  seedNetwork(db);
  seedMultiTileArea(db);
  const urls: string[] = [];
  let fallbackSuccesses = 0;

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === primary && urls.length === 1) return new Response('', { status: 504 });
      if (url === fallback) {
        fallbackSuccesses += 1;
        if (fallbackSuccesses === 2) return new Response('', { status: 504 });
      }
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  assert.deepEqual(urls.slice(0, 5), [primary, fallback, fallback, primary, primary]);
  const row = db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get() as { metrics_json: string };
  const metrics = JSON.parse(row.metrics_json) as { preferredOverpassUrl?: string };
  assert.equal(metrics.preferredOverpassUrl, primary);
});
