import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { workBucket } from '../worker/streetNetwork/baseStorage.ts';

// The one-time progress import (src/v5/engine/legacy.ts) reads the legacy snapshot GET. On a campaign that ran on migration 0023+
// the tasks live in street_base_chunks + street_work_overlays, not in the tasks tables: without mergePreparedSnapshot the import would see no progress.
test('the legacy snapshot merges prepared base rows with their work overlay (what the progress import reads)', async () => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  const t = '2026-09-07T00:00:00.000Z';
  const house = { id: 'h1', taskType: 'house', areaId: 'area_n', label: 'Straße 1', status: 'open', completedAt: null, createdAt: t, updatedAt: t, source: { objectType: 'way', objectIds: [101] } };
  db.sqlite.prepare("INSERT INTO street_base_areas(campaign_id,area_id,generation) VALUES('campaign_n','area_n','g1')").run();
  db.sqlite.prepare("INSERT INTO street_base_chunks(campaign_id,area_id,content_hash,kind,bucket,payload_json) VALUES('campaign_n','area_n','hash1','house',?,?)").run(workBucket('h1'), JSON.stringify([house]));
  db.sqlite.prepare("INSERT INTO street_work_overlays(campaign_id,area_id,bucket,payload_json) VALUES('campaign_n','area_n',?,?)")
    .run(workBucket('h1'), JSON.stringify({ h1: { label: 'Straße 1', status: 'completed', completedAt: t, createdAt: t, updatedAt: t } }));
  const snapshot = await loadCampaignSnapshot(db, 'campaign_n');
  const merged = (snapshot?.houseTasks ?? []).find((h) => h.id === 'h1');
  assert.equal(merged?.status, 'completed');
  assert.equal(merged?.source?.objectIds?.[0], 101);
});
