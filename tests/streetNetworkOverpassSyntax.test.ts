import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

test('building Overpass union terminates the address-node statement before closing the union', async () => {
  const db = new NetworkD1();
  seedNetwork(db);
  const queries: string[] = [];

  const result = await prepareAreaTasks(db, 'campaign_n', 'area_n', {
    fetchImpl: async (_input, init) => {
      const body = new URLSearchParams(String(init?.body ?? ''));
      queries.push(body.get('data') ?? '');
      return networkOsm();
    },
  });

  assert.equal(result.outcome, 'ready');
  const buildingQuery = queries.find((query) => query.includes('way["building"]'));
  assert.ok(buildingQuery, 'expected at least one building query');
  assert.match(
    buildingQuery,
    /\(way\["building"\]\([^)]*\);node\["addr:housenumber"\]\([^)]*\);\);out body geom;/u,
  );
});
