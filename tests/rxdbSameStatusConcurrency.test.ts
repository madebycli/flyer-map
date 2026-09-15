import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampaignSnapshot, HouseTask } from '../src/domain/campaign.ts';
import { deriveMutationFromRxdbWrite } from '../src/domain/rxdbMutationAdapter.ts';
import type { AccessContext } from '../worker/access.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPush } from '../worker/rxdbSync.ts';
import { NetworkD1, seedNetwork } from './helpers/networkD1.ts';

const stamp = '2026-09-14T18:00:00.000Z';
const firstCompletion = '2026-09-14T18:10:00.000Z';
const secondCompletion = '2026-09-14T18:10:05.000Z';

function adapterSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: {
      id: 'campaign_same',
      name: 'Mission',
      status: 'active',
      defaultMapView: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    teams: [{
      id: 'team_same',
      campaignId: 'campaign_same',
      name: 'Team',
      color: '#2563eb',
      createdAt: stamp,
      updatedAt: stamp,
    }],
    areas: [{
      id: 'area_same',
      campaignId: 'campaign_same',
      teamId: 'team_same',
      name: 'Area',
      geometry: {
        type: 'Polygon',
        coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
      },
      createdAt: stamp,
      updatedAt: stamp,
    }],
    tasks: [{
      id: 'street_same',
      campaignId: 'campaign_same',
      areaId: 'area_same',
      taskType: 'street',
      label: 'Straße',
      geometry: { type: 'LineString', coordinates: [[13.001, 51.005], [13.009, 51.005]] },
      status: 'open',
      completedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    }],
    houseTasks: [{
      id: 'house_same',
      campaignId: 'campaign_same',
      areaId: 'area_same',
      taskType: 'house',
      label: '1',
      geometry: {
        type: 'Polygon',
        coordinates: [[[13.002, 51.0051], [13.00203, 51.0051], [13.00203, 51.00513], [13.002, 51.0051]]],
      },
      parentStreetTaskId: null,
      status: 'open',
      completedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    }],
  };
}

test('Street and House concurrent completion writes keep the first canonical completedAt and ACK the same status', () => {
  const streetSnapshot = adapterSnapshot();
  const staleStreet = { ...streetSnapshot.tasks[0] };
  streetSnapshot.tasks[0] = {
    ...staleStreet,
    status: 'completed',
    completedAt: firstCompletion,
    updatedAt: firstCompletion,
  };
  assert.deepEqual(deriveMutationFromRxdbWrite('streetTasks', streetSnapshot, {
    assumedMasterState: staleStreet,
    newDocumentState: {
      ...staleStreet,
      status: 'completed',
      completedAt: secondCompletion,
      updatedAt: secondCompletion,
    },
  }, secondCompletion), { kind: 'ack' });

  const houseSnapshot = adapterSnapshot();
  const staleHouse = { ...houseSnapshot.houseTasks![0] };
  houseSnapshot.houseTasks![0] = {
    ...staleHouse,
    status: 'completed',
    completedAt: firstCompletion,
    updatedAt: firstCompletion,
  };
  assert.deepEqual(deriveMutationFromRxdbWrite('houseTasks', houseSnapshot, {
    assumedMasterState: staleHouse,
    newDocumentState: {
      ...staleHouse,
      status: 'completed',
      completedAt: secondCompletion,
      updatedAt: secondCompletion,
    },
  }, secondCompletion), { kind: 'ack' });
});

test('different concurrent target statuses remain conflicts', () => {
  const current = adapterSnapshot();
  const stale = { ...current.houseTasks![0] };
  current.houseTasks![0] = {
    ...stale,
    status: 'completed',
    completedAt: firstCompletion,
    updatedAt: firstCompletion,
  };
  assert.deepEqual(deriveMutationFromRxdbWrite('houseTasks', current, {
    assumedMasterState: stale,
    newDocumentState: {
      ...stale,
      status: 'later',
      completedAt: null,
      updatedAt: secondCompletion,
    },
  }, secondCompletion), { kind: 'conflict', reason: 'house_status_changed' });
});

const access: AccessContext = {
  grantId: 'same_status_admin',
  campaignId: 'campaign_n',
  role: 'admin',
  teamId: null,
  label: 'Same status test',
};

function seedManualHouse(db: NetworkD1) {
  const house: HouseTask = {
    id: 'task_house_manual_same',
    campaignId: 'campaign_n',
    areaId: 'area_n',
    taskType: 'house',
    label: '1',
    geometry: {
      type: 'Polygon',
      coordinates: [[[13.002, 51.0051], [13.00203, 51.0051], [13.00203, 51.00513], [13.002, 51.0051]]],
    },
    parentStreetTaskId: null,
    status: 'open',
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.sqlite.prepare(`
    INSERT INTO house_tasks(
      id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
      status, completed_at, created_at, updated_at, area_preparation_generation
    ) VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
  `).run(
    house.id,
    house.campaignId,
    house.areaId,
    house.parentStreetTaskId,
    house.label,
    JSON.stringify(house.geometry),
    house.status,
    house.completedAt,
    house.createdAt,
    house.updatedAt,
  );
}

test('second same-completion RxDB push does not create another revision, event, or feed row', async () => {
  const db = new NetworkD1(true, true);
  seedNetwork(db);
  seedManualHouse(db);
  try {
    const initial = (await loadCampaignSnapshot(db, 'campaign_n'))!;
    const staleHouse = initial.houseTasks!.find(house => house.id === 'task_house_manual_same')!;

    const first = await handleRxdbPush(db, 'campaign_n', 'houseTasks', access, {
      rows: [{
        assumedMasterState: staleHouse,
        newDocumentState: {
          ...staleHouse,
          status: 'completed',
          completedAt: firstCompletion,
          updatedAt: firstCompletion,
        },
      }],
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { conflicts: [], rejections: [] });

    const revisionAfterFirst = Number(db.sqlite.prepare('SELECT revision FROM campaigns WHERE id=?').get('campaign_n')?.revision);
    const eventsAfterFirst = Number(db.sqlite.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE campaign_id=? AND entity_id=? AND event_type='task.status.changed'").get('campaign_n', staleHouse.id)?.n);
    const feedAfterFirst = Number(db.sqlite.prepare("SELECT COUNT(*) AS n FROM campaign_sync_changes WHERE campaign_id=? AND collection_name='houseTasks' AND document_id=?").get('campaign_n', staleHouse.id)?.n);
    assert.equal(revisionAfterFirst, 2);
    assert.equal(eventsAfterFirst, 1);
    assert.equal(feedAfterFirst, 1);

    const second = await handleRxdbPush(db, 'campaign_n', 'houseTasks', access, {
      rows: [{
        assumedMasterState: staleHouse,
        newDocumentState: {
          ...staleHouse,
          status: 'completed',
          completedAt: secondCompletion,
          updatedAt: secondCompletion,
        },
      }],
    });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { conflicts: [], rejections: [] });

    assert.equal(Number(db.sqlite.prepare('SELECT revision FROM campaigns WHERE id=?').get('campaign_n')?.revision), revisionAfterFirst);
    assert.equal(Number(db.sqlite.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE campaign_id=? AND entity_id=? AND event_type='task.status.changed'").get('campaign_n', staleHouse.id)?.n), eventsAfterFirst);
    assert.equal(Number(db.sqlite.prepare("SELECT COUNT(*) AS n FROM campaign_sync_changes WHERE campaign_id=? AND collection_name='houseTasks' AND document_id=?").get('campaign_n', staleHouse.id)?.n), feedAfterFirst);
    const canonical = (await loadCampaignSnapshot(db, 'campaign_n'))!.houseTasks!.find(house => house.id === staleHouse.id)!;
    assert.equal(canonical.status, 'completed');
    assert.equal(canonical.completedAt, firstCompletion);
  } finally {
    db.sqlite.close();
  }
});
