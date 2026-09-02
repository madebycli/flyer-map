import assert from "node:assert/strict";
import test from "node:test";
import type { DistributionTask } from "../src/domain/campaign.ts";
import {
  materializePreparedStreetTasks,
  reconcilePreparedStreetTasks,
} from "../worker/streetPreparation/reconcilePreparedStreetTasks.ts";
import {
  preparedStreetFragmentKey,
  preparedStreetSourceKey,
  stablePreparedStreetTaskId,
} from "../worker/streetPreparation/roadIdentity.ts";
import type { PreparedStreetCandidate } from "../worker/streetPreparation/types.ts";

const geometry = {
  type: "LineString" as const,
  coordinates: [[8, 49], [8.01, 49]] as [number, number][],
};

function candidate(overrides: Partial<PreparedStreetCandidate> = {}): PreparedStreetCandidate {
  return {
    sourceOsmWayId: 123,
    sourceKey: preparedStreetSourceKey({ sourceOsmWayId: 123, geometry }),
    fragmentKey: preparedStreetFragmentKey({ sourceOsmWayId: 123, geometry }),
    label: "Ringstraße",
    geometry,
    ...overrides,
  };
}

function task(input: Partial<DistributionTask> & Pick<DistributionTask, "id">): DistributionTask {
  return {
    id: input.id,
    campaignId: input.campaignId ?? "campaign_1",
    areaId: input.areaId ?? "area_1",
    taskType: "street",
    label: input.label ?? input.id,
    geometry: input.geometry ?? geometry,
    source: input.source ?? {
      dataset: "OpenStreetMap",
      objectType: "way",
      objectIds: [123],
    },
    areaPreparationGeneration: input.areaPreparationGeneration ?? null,
    status: input.status ?? "open",
    completedAt: input.completedAt ?? null,
    createdAt: input.createdAt ?? "2026-09-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-09-01T00:00:00.000Z",
  };
}

test("same prepared candidate converges to one SHA-256 canonical identity", async () => {
  const tasks = await materializePreparedStreetTasks({
    candidates: [
      candidate(),
      candidate({ geometry: { type: "LineString", coordinates: [...geometry.coordinates].reverse() } }),
    ],
    campaignId: "campaign_1",
    areaId: "area_1",
    generation: "generation-1",
    timestamp: "2026-09-02T00:00:00.000Z",
  });

  assert.equal(tasks.length, 1);
  assert.match(tasks[0].id, /^task_auto_[a-f0-9]{64}$/u);
  assert.equal(
    tasks[0].id,
    await stablePreparedStreetTaskId({
      campaignId: "campaign_1",
      areaId: "area_1",
      sourceOsmWayId: 123,
      geometry,
    }),
  );
});

test("same stable ID refreshes server fields and preserves user-owned fields", async () => {
  const oldTasks = await materializePreparedStreetTasks({
    candidates: [candidate()],
    campaignId: "campaign_1",
    areaId: "area_1",
    generation: "generation-old",
    timestamp: "2026-09-01T00:00:00.000Z",
  });
  const existing = {
    ...oldTasks[0],
    label: "Vom Team umbenannt",
    status: "later" as const,
    completedAt: null,
    createdAt: "2026-08-31T12:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  const preparedTasks = await materializePreparedStreetTasks({
    candidates: [candidate()],
    campaignId: "campaign_1",
    areaId: "area_1",
    generation: "generation-new",
    timestamp: "2026-09-02T10:00:00.000Z",
  });

  const result = reconcilePreparedStreetTasks({
    existingTasks: [existing],
    preparedTasks,
    campaignId: "campaign_1",
    areaId: "area_1",
  });

  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.deepEqual(result.inserts, []);
  assert.deepEqual(result.deleteIds, []);
  assert.deepEqual(result.unchangedIds, []);
  assert.equal(result.updates.length, 1);
  const updated = result.updates[0];
  assert.equal(updated.id, existing.id);
  assert.equal(updated.label, existing.label);
  assert.equal(updated.status, existing.status);
  assert.equal(updated.completedAt, existing.completedAt);
  assert.equal(updated.createdAt, existing.createdAt);
  assert.equal(updated.areaPreparationGeneration, "generation-new");
  assert.equal(updated.updatedAt, "2026-09-02T10:00:00.000Z");
  assert.deepEqual(result.afterTasks, [updated]);
});

test("manual and other-area tasks remain outside the reconcile delta", () => {
  const manual = task({ id: "task_manual", areaPreparationGeneration: null, label: "Manuell" });
  const otherArea = task({
    id: "task_auto_other_area",
    areaId: "area_2",
    areaPreparationGeneration: "old-generation",
  });
  const result = reconcilePreparedStreetTasks({
    existingTasks: [manual, otherArea],
    preparedTasks: [],
    campaignId: "campaign_1",
    areaId: "area_1",
  });

  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.deepEqual(result.deleteIds, []);
  assert.equal(result.afterTasks.length, 2);
});

test("worked obsolete automatic streets require action and are never deleted", () => {
  const worked = task({
    id: "task_auto_worked",
    areaPreparationGeneration: "old-generation",
    status: "later",
  });
  const result = reconcilePreparedStreetTasks({
    existingTasks: [worked],
    preparedTasks: [],
    campaignId: "campaign_1",
    areaId: "area_1",
  });

  assert.deepEqual(result, {
    outcome: "blocked-worked",
    workedTaskIds: ["task_auto_worked"],
  });
});
