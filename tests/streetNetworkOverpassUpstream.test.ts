import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

test('street preparation uses the live-compatible default Overpass upstream', async () => {
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
  assert.deepEqual([...new Set(urls)], ['https://overpass.private.coffee/api/interpreter']);
});
