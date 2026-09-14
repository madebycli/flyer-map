import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessContext } from '../worker/access.ts';
import { handleRxdbPull } from '../worker/rxdbSync.ts';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';

const access: AccessContext = {
  grantId: 'retention_admin',
  campaignId: 'campaign_n',
  role: 'admin',
  teamId: null,
  label: 'Retention test',
};

const time = '2026-09-14T18:00:00.000Z';

function insertTeamFeedRow(db: NetworkD1) {
  const document = {
    id: 'team_n',
    campaignId: 'campaign_n',
    name: 'Team',
    color: '#2563eb',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: time,
  };
  const result = db.sqlite.prepare(`
    INSERT INTO campaign_sync_changes(
      campaign_id, collection_name, document_id, operation, scope_team_id, document_json, changed_at
    ) VALUES(?, 'teams', ?, 'upsert', NULL, ?, ?)
  `).run('campaign_n', 'team_n', JSON.stringify(document), time);
  return Number(result.lastInsertRowid);
}

test('retained feed floor rejects an old checkpoint instead of silently skipping compacted changes', async () => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  try {
    const seq = insertTeamFeedRow(db);
    db.sqlite.prepare(`
      INSERT INTO campaign_sync_retention(campaign_id, collection_name, min_checkpoint_seq, epoch, updated_at)
      VALUES(?, 'teams', ?, 2, ?)
    `).run('campaign_n', seq, time);

    // Simulate the future compaction state. The retained head survives through
    // campaign_sync_heads while the physical feed row no longer exists.
    db.sqlite.prepare("DELETE FROM campaign_sync_changes WHERE campaign_id=? AND collection_name='teams' AND seq<=?")
      .run('campaign_n', seq);

    const expired = await handleRxdbPull(db, 'campaign_n', 'teams', access, {
      checkpoint: { seq: 0 },
      batchSize: 100,
    });
    assert.equal(expired.status, 409);
    assert.deepEqual(await expired.json(), {
      error: {
        code: 'rxdb_checkpoint_expired',
        message: 'Der lokale RxDB-Checkpoint ist älter als der aufbewahrte Change-Feed und muss neu aufgebaut werden.',
      },
      retention: { minCheckpointSeq: seq, epoch: 2 },
    });

    const atFloor = await handleRxdbPull(db, 'campaign_n', 'teams', access, {
      checkpoint: { seq },
      batchSize: 100,
    });
    assert.equal(atFloor.status, 200);
    const incremental = await atFloor.json() as { documents: unknown[]; checkpoint: { seq: number } };
    assert.deepEqual(incremental.documents, []);
    assert.equal(incremental.checkpoint.seq, seq);

    const bootstrap = await handleRxdbPull(db, 'campaign_n', 'teams', access, {
      checkpoint: null,
      batchSize: 100,
    });
    assert.equal(bootstrap.status, 200);
    const bootstrapped = await bootstrap.json() as { documents: Array<{ id: string }>; checkpoint: { seq: number } };
    assert.deepEqual(bootstrapped.documents.map(document => document.id), ['team_n']);
    assert.equal(bootstrapped.checkpoint.seq, seq);
  } finally {
    db.sqlite.close();
  }
});
