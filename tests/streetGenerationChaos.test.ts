import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessContext } from '../worker/access.ts';
import {
  beginAreaTaskPreparation,
  getAreaTaskPreparationState,
  prepareAreaTasks,
  runAreaTaskPreparation,
} from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPush } from '../worker/rxdbSync.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

const access: AccessContext = {
  grantId: 'generation_admin',
  campaignId: 'campaign_n',
  role: 'admin',
  teamId: null,
  label: 'Generation chaos test',
};

function resizedGeometry() {
  return {
    type: 'Polygon' as const,
    coordinates: [[
      [13, 51],
      [13.009, 51],
      [13.009, 51.009],
      [13, 51.009],
      [13, 51],
    ]],
  };
}

function secondResizeGeometry() {
  return {
    type: 'Polygon' as const,
    coordinates: [[
      [13, 51],
      [13.008, 51],
      [13.008, 51.008],
      [13, 51.008],
      [13, 51],
    ]],
  };
}

function deferredResponse() {
  let startedResolve: (() => void) | null = null;
  let releaseResolve: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const response = new Promise<Response>((resolve) => {
    releaseResolve = () => resolve(networkOsm());
  });
  return {
    started,
    release: () => releaseResolve?.(),
    fetchImpl: async () => {
      startedResolve?.();
      return (await response).clone();
    },
  };
}

test('Area resize supersedes an active generation, fences the old worker, and rejects a stale resize', async () => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  const gate = deferredResponse();
  try {
    const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', { fetchImpl: gate.fetchImpl });
    assert.equal(started.outcome, 'run');
    if (started.outcome !== 'run') return;
    const oldGeneration = started.run.generation;
    const oldInvocation = runAreaTaskPreparation(db, started.run, { fetchImpl: gate.fetchImpl });
    await gate.started;

    const before = (await loadCampaignSnapshot(db, 'campaign_n'))!;
    const staleArea = before.areas.find(area => area.id === 'area_n')!;
    let schedules = 0;
    const resize = await handleRxdbPush(db, 'campaign_n', 'areas', access, {
      rows: [{
        assumedMasterState: staleArea,
        newDocumentState: {
          ...staleArea,
          geometry: resizedGeometry(),
          updatedAt: '2026-09-14T18:30:00.000Z',
        },
      }],
    }, {
      schedule: async () => { schedules += 1; },
    });
    assert.equal(resize.status, 200);
    assert.deepEqual(await resize.json(), { conflicts: [], rejections: [] });
    assert.equal(schedules, 1);

    const superseding = await getAreaTaskPreparationState(db, 'campaign_n', 'area_n');
    assert.ok(superseding);
    assert.equal(superseding.status, 'pending');
    assert.notEqual(superseding.generation, oldGeneration);
    const newGeneration = superseding.generation;

    // A second client that still believes the original Area is current must
    // conflict against the canonical resize instead of replacing its generation.
    const staleResize = await handleRxdbPush(db, 'campaign_n', 'areas', access, {
      rows: [{
        assumedMasterState: staleArea,
        newDocumentState: {
          ...staleArea,
          geometry: secondResizeGeometry(),
          updatedAt: '2026-09-14T18:31:00.000Z',
        },
      }],
    }, {
      schedule: async () => { schedules += 1; },
    });
    assert.equal(staleResize.status, 200);
    const stalePayload = await staleResize.json() as {
      conflicts: Array<{ geometry: unknown }>;
      rejections: Array<{ documentId: string; code: string }>;
    };
    assert.equal(stalePayload.conflicts.length, 1);
    assert.deepEqual(stalePayload.rejections, [{ documentId: 'area_n', code: 'area_changed' }]);
    assert.deepEqual(stalePayload.conflicts[0].geometry, resizedGeometry());
    assert.equal((await getAreaTaskPreparationState(db, 'campaign_n', 'area_n'))?.generation, newGeneration);
    assert.equal(schedules, 1, 'conflicting stale resize must not schedule another generation');

    gate.release();
    const oldResult = await oldInvocation;
    assert.equal(oldResult.outcome, 'pending');
    assert.equal((await getAreaTaskPreparationState(db, 'campaign_n', 'area_n'))?.generation, newGeneration);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM street_base_areas WHERE campaign_id=? AND area_id=?').get('campaign_n', 'area_n')?.n, 0);

    const replacement = await prepareAreaTasks(db, 'campaign_n', 'area_n', { fetchImpl: async () => networkOsm() });
    assert.equal(replacement.outcome, 'ready');
    if (replacement.outcome !== 'ready') return;
    assert.equal(replacement.generation, newGeneration);
    assert.equal((await getAreaTaskPreparationState(db, 'campaign_n', 'area_n'))?.generation, newGeneration);
    assert.equal(db.sqlite.prepare('SELECT generation FROM street_base_areas WHERE campaign_id=? AND area_id=?').get('campaign_n', 'area_n')?.generation, newGeneration);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=?').get('campaign_n', 'area_n', oldGeneration)?.n, 0);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.sqlite.close();
  }
});

test('Area delete during an active generation removes all preparation ownership and old work cannot resurrect it', async () => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  const gate = deferredResponse();
  try {
    const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', { fetchImpl: gate.fetchImpl });
    assert.equal(started.outcome, 'run');
    if (started.outcome !== 'run') return;
    const oldGeneration = started.run.generation;
    const oldInvocation = runAreaTaskPreparation(db, started.run, { fetchImpl: gate.fetchImpl });
    await gate.started;

    const before = (await loadCampaignSnapshot(db, 'campaign_n'))!;
    const area = before.areas.find(candidate => candidate.id === 'area_n')!;
    const deletion = await handleRxdbPush(db, 'campaign_n', 'areas', access, {
      rows: [{
        assumedMasterState: area,
        newDocumentState: { ...area, _deleted: true },
      }],
    });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { conflicts: [], rejections: [] });

    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM areas WHERE id=? AND campaign_id=?').get('area_n', 'campaign_n')?.n, 0);
    for (const table of ['area_task_preparations', 'street_network_jobs', 'street_network_staging', 'street_base_areas', 'street_base_chunks']) {
      assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE campaign_id=? AND area_id=?`).get('campaign_n', 'area_n')?.n, 0, table);
    }

    gate.release();
    const oldResult = await oldInvocation;
    assert.equal(oldResult.outcome, 'pending');
    assert.equal(await getAreaTaskPreparationState(db, 'campaign_n', 'area_n'), null);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=?').get('campaign_n', 'area_n', oldGeneration)?.n, 0);
    assert.equal((await loadCampaignSnapshot(db, 'campaign_n'))?.areas.length, 0);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.sqlite.close();
  }
});