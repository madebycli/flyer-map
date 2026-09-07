import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  DistributionTask,
  LineStringGeometry,
  TaskStatus,
} from "../src/domain/campaign.ts";
import {
  AREA_STREET_PREPARATION_ALGORITHM_VERSION,
  areaPreparationFingerprint,
} from "../worker/areaTaskPreparation.ts";
import { rxdbChangeFeedEntriesForSnapshotDelta } from "../worker/rxdbChangeFeed.ts";
import {
  AUTO_STREET_SERVER_OWNED_FIELDS,
  AUTO_STREET_USER_OWNED_FIELDS,
  canonicalStreetFragmentGeometryJson,
  reconcileServerPreparedStreetTasks,
  stablePreparedStreetTaskId,
  type PreparedStreetCandidate,
} from "../worker/serverPreparedStreetReconcile.ts";

const campaignId = "campaign_reconcile";
const areaId = "area_reconcile";
const timestamp = "2026-09-02T18:00:00.000Z";
const nextTimestamp = "2026-09-02T19:00:00.000Z";

function line(points: [number, number][]): LineStringGeometry {
  return { type: "LineString", coordinates: points };
}

function candidate(index: number): PreparedStreetCandidate {
  return {
    sourceOsmWayId: 10_000 + index,
    label: `Street ${index}`,
    geometry: line([[index, 0], [index + 0.5, 0.5], [index + 1, 1]]),
  };
}

function snapshot(tasks: DistributionTask[], revision = 1): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision,
    campaign: {
      id: campaignId,
      name: "Reconcile",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [{
      id: "team_reconcile",
      campaignId,
      name: "Team",
      color: "#2563eb",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    areas: [{
      id: areaId,
      campaignId,
      teamId: "team_reconcile",
      name: "Area",
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [600, 0], [600, 2], [0, 2], [0, 0]]],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    tasks,
    houseTasks: [],
  };
}

async function firstMaterialization(fragments: PreparedStreetCandidate[]) {
  const plan = await reconcileServerPreparedStreetTasks({
    existingTasks: [],
    preparedFragments: fragments,
    campaignId,
    areaId,
    generation: "generation-1",
    timestamp,
  });
  assert.equal(plan.outcome, "ready");
  return plan;
}

test("stable Street identity uses campaign, area, OSM way and canonical fragment geometry", async () => {
  const geometry = line([[1, 1], [2, 2], [3, 1]]);
  const reversed = line([[3, 1], [2, 2], [1, 1]]);
  const identity = { campaignId, areaId, sourceOsmWayId: 42, geometry };
  const first = await stablePreparedStreetTaskId(identity);
  assert.equal(first, await stablePreparedStreetTaskId(identity));
  assert.equal(first, await stablePreparedStreetTaskId({ ...identity, geometry: reversed }));
  assert.equal(
    canonicalStreetFragmentGeometryJson(geometry),
    canonicalStreetFragmentGeometryJson(reversed),
  );
  assert.notEqual(first, await stablePreparedStreetTaskId({ ...identity, campaignId: "campaign_other" }));
  assert.notEqual(first, await stablePreparedStreetTaskId({ ...identity, areaId: "area_other" }));
  assert.notEqual(first, await stablePreparedStreetTaskId({ ...identity, sourceOsmWayId: 43 }));
  assert.notEqual(first, await stablePreparedStreetTaskId({
    ...identity,
    geometry: line([[1, 1], [2, 2], [3.0000000001, 1]]),
  }));
});

test("server/user ownership contract explicitly preserves editable label and work state", () => {
  assert.deepEqual(AUTO_STREET_SERVER_OWNED_FIELDS, [
    "id", "campaignId", "areaId", "taskType", "geometry", "source", "areaPreparationGeneration",
  ]);
  assert.deepEqual(AUTO_STREET_USER_OWNED_FIELDS, ["label", "status", "completedAt", "createdAt"]);
});

test("unchanged stable auto Street preserves ID, label, status, completedAt, createdAt and generation", async () => {
  const fragment = candidate(1);
  const created = await firstMaterialization([fragment]);
  const base = created.afterTasks[0];
  for (const status of ["completed", "later", "not-deliverable"] satisfies TaskStatus[]) {
    const existing: DistributionTask = {
      ...base,
      label: "User renamed label",
      status,
      completedAt: status === "completed" ? "2026-09-02T18:30:00.000Z" : null,
      updatedAt: "2026-09-02T18:31:00.000Z",
    };
    const plan = await reconcileServerPreparedStreetTasks({
      existingTasks: [existing],
      preparedFragments: [{ ...fragment, label: "New automatic label" }],
      campaignId,
      areaId,
      generation: "generation-2",
      timestamp: nextTimestamp,
    });
    assert.equal(plan.outcome, "ready");
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.deleteIds.length, 0);
    assert.deepEqual(plan.afterTasks, [existing]);
    assert.equal(plan.afterTasks[0].id, base.id);
    assert.equal(plan.afterTasks[0].label, "User renamed label");
    assert.equal(plan.afterTasks[0].status, status);
    assert.equal(plan.afterTasks[0].completedAt, existing.completedAt);
    assert.equal(plan.afterTasks[0].createdAt, timestamp);
    assert.equal(plan.afterTasks[0].areaPreparationGeneration, "generation-1");
  }
});

test("manual Street remains business-identical during auto reconcile", async () => {
  const manual: DistributionTask = {
    id: "task_manual",
    campaignId,
    areaId,
    taskType: "street",
    label: "Manual custom label",
    geometry: line([[20, 0], [21, 1]]),
    source: null,
    areaPreparationGeneration: null,
    status: "later",
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const plan = await reconcileServerPreparedStreetTasks({
    existingTasks: [manual],
    preparedFragments: [candidate(1)],
    campaignId,
    areaId,
    generation: "generation-1",
    timestamp,
  });
  assert.equal(plan.outcome, "ready");
  assert.deepEqual(plan.afterTasks.find((task) => task.id === manual.id), manual);
});

test("obsolete open auto Street is deleted and snapshot delta produces one tombstone", async () => {
  const first = await firstMaterialization([candidate(1)]);
  const obsolete = first.afterTasks[0];
  const second = await reconcileServerPreparedStreetTasks({
    existingTasks: [obsolete],
    preparedFragments: [],
    campaignId,
    areaId,
    generation: "generation-2",
    timestamp: nextTimestamp,
  });
  assert.equal(second.outcome, "ready");
  assert.deepEqual(second.deleteIds, [obsolete.id]);
  assert.deepEqual(second.afterTasks, []);
  const changes = rxdbChangeFeedEntriesForSnapshotDelta(snapshot([obsolete]), snapshot([], 2));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].collectionName, "streetTasks");
  assert.equal(changes[0].document.id, obsolete.id);
  assert.equal(changes[0].document._deleted, true);
});

test("obsolete worked auto Street fails closed without deletion, reset or duplicate", async () => {
  const first = await firstMaterialization([candidate(1)]);
  for (const status of ["completed", "later", "not-deliverable"] satisfies TaskStatus[]) {
    const worked: DistributionTask = {
      ...first.afterTasks[0],
      status,
      completedAt: status === "completed" ? nextTimestamp : null,
    };
    const plan = await reconcileServerPreparedStreetTasks({
      existingTasks: [worked],
      preparedFragments: [],
      campaignId,
      areaId,
      generation: "generation-2",
      timestamp: nextTimestamp,
    });
    assert.deepEqual(plan, { outcome: "blocked-worked", workedTaskIds: [worked.id] });
  }
});

test("500 identical stable Streets cause zero Street inserts, deletes and feed entries on reprepare", async () => {
  const fragments = Array.from({ length: 500 }, (_, index) => candidate(index));
  const first = await firstMaterialization(fragments);
  assert.equal(first.inserts.length, 500);
  const second = await reconcileServerPreparedStreetTasks({
    existingTasks: first.afterTasks,
    preparedFragments: fragments,
    campaignId,
    areaId,
    generation: "generation-2",
    timestamp: nextTimestamp,
  });
  assert.equal(second.outcome, "ready");
  assert.equal(second.inserts.length, 0);
  assert.equal(second.deleteIds.length, 0);
  assert.equal(second.unchangedIds.length, 500);
  const changes = rxdbChangeFeedEntriesForSnapshotDelta(
    snapshot(first.afterTasks),
    snapshot(second.afterTasks, 2),
  ).filter((entry) => entry.collectionName === "streetTasks");
  assert.equal(changes.length, 0);
});

test("changing one of 500 fragments produces exactly one insert, one delete and two Street feed entries", async () => {
  const fragments = Array.from({ length: 500 }, (_, index) => candidate(index));
  const first = await firstMaterialization(fragments);
  const changed = [...fragments];
  changed[249] = {
    ...changed[249],
    geometry: line([[249, 0], [249.5, 0.75], [250, 1]]),
  };
  const second = await reconcileServerPreparedStreetTasks({
    existingTasks: first.afterTasks,
    preparedFragments: changed,
    campaignId,
    areaId,
    generation: "generation-2",
    timestamp: nextTimestamp,
  });
  assert.equal(second.outcome, "ready");
  assert.equal(second.inserts.length, 1);
  assert.equal(second.deleteIds.length, 1);
  assert.equal(second.unchangedIds.length, 499);
  const changes = rxdbChangeFeedEntriesForSnapshotDelta(
    snapshot(first.afterTasks),
    snapshot(second.afterTasks, 2),
  ).filter((entry) => entry.collectionName === "streetTasks");
  assert.equal(changes.length, 2);
  assert.equal(changes.filter((entry) => entry.document._deleted).length, 1);
  assert.equal(changes.filter((entry) => !entry.document._deleted).length, 1);
});

test("algorithm version participates in preparation fingerprint but not stable Street identity", async () => {
  const geometry = snapshot([]).areas[0].geometry;
  const current = await areaPreparationFingerprint(geometry);
  assert.equal(current, await areaPreparationFingerprint(geometry, AREA_STREET_PREPARATION_ALGORITHM_VERSION));
  assert.notEqual(current, await areaPreparationFingerprint(geometry, "street-v2"));
  const fragment = candidate(3);
  const stable = await stablePreparedStreetTaskId({
    campaignId,
    areaId,
    sourceOsmWayId: fragment.sourceOsmWayId,
    geometry: fragment.geometry,
  });
  assert.equal(stable, await stablePreparedStreetTaskId({
    campaignId,
    areaId,
    sourceOsmWayId: fragment.sourceOsmWayId,
    geometry: fragment.geometry,
  }));
});
