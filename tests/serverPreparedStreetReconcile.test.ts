import assert from "node:assert/strict";
import test from "node:test";
import type { DistributionTask } from "../src/domain/campaign.ts";
import { reconcileServerPreparedStreetTasks } from "../worker/serverPreparedStreetReconcile.ts";

const geometry = {
  type: "LineString" as const,
  coordinates: [[8, 49], [8.01, 49]] as [number, number][],
};

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

test("reconcile preserves existing user-owned fields and only inserts/deletes the delta", () => {
  const manual = task({ id: "task_manual", areaPreparationGeneration: null, label: "Manuell" });
  const unchanged = task({
    id: "task_auto_same",
    areaPreparationGeneration: "old-generation",
    label: "Vom Nutzer umbenannt",
    status: "completed",
    completedAt: "2026-09-01T10:00:00.000Z",
  });
  const obsoleteOpen = task({
    id: "task_auto_obsolete",
    areaPreparationGeneration: "old-generation",
  });
  const preparedSame = task({
    id: "task_auto_same",
    areaPreparationGeneration: "new-generation",
    label: "Serverlabel",
    status: "open",
  });
  const preparedNew = task({
    id: "task_auto_new",
    areaPreparationGeneration: "new-generation",
  });

  const result = reconcileServerPreparedStreetTasks({
    existingTasks: [manual, unchanged, obsoleteOpen],
    preparedTasks: [preparedSame, preparedNew],
    campaignId: "campaign_1",
    areaId: "area_1",
  });

  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.deepEqual(result.deleteIds, ["task_auto_obsolete"]);
  assert.deepEqual(result.unchangedIds, ["task_auto_new", "task_auto_same"].sort());
  assert.deepEqual(result.inserts.map((candidate) => candidate.id), ["task_auto_new"]);
  assert.equal(result.afterTasks.find((candidate) => candidate.id === "task_manual")?.label, "Manuell");
  assert.equal(result.afterTasks.find((candidate) => candidate.id === "task_auto_same")?.label, "Vom Nutzer umbenannt");
  assert.equal(result.afterTasks.find((candidate) => candidate.id === "task_auto_same")?.status, "completed");
});

test("reconcile blocks an obsolete worked automatic street and never deletes it", () => {
  const worked = task({
    id: "task_auto_worked",
    areaPreparationGeneration: "old-generation",
    status: "later",
  });
  const result = reconcileServerPreparedStreetTasks({
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

test("manual tasks and tasks from another area are not reconciliation targets", () => {
  const manual = task({ id: "task_manual", areaPreparationGeneration: null });
  const otherArea = task({
    id: "task_auto_other_area",
    areaId: "area_2",
    areaPreparationGeneration: "old-generation",
  });
  const result = reconcileServerPreparedStreetTasks({
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
