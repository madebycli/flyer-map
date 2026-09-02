import type { DistributionTask } from "../src/domain/campaign.ts";

export type PreparedStreetReconcileInput = {
  existingTasks: DistributionTask[];
  preparedTasks: DistributionTask[];
  campaignId: string;
  areaId: string;
};

export type PreparedStreetReconcileReady = {
  outcome: "ready";
  inserts: DistributionTask[];
  deleteIds: string[];
  unchangedIds: string[];
  afterTasks: DistributionTask[];
};

export type PreparedStreetReconcileBlocked = {
  outcome: "blocked-worked";
  workedTaskIds: string[];
};

export type PreparedStreetReconcileResult =
  | PreparedStreetReconcileReady
  | PreparedStreetReconcileBlocked;

function isAutomaticStreet(task: DistributionTask, campaignId: string, areaId: string) {
  return task.campaignId === campaignId
    && task.areaId === areaId
    && task.taskType === "street"
    && typeof task.areaPreparationGeneration === "string"
    && task.areaPreparationGeneration.length > 0;
}

export function reconcileServerPreparedStreetTasks(
  input: PreparedStreetReconcileInput,
): PreparedStreetReconcileResult {
  const existing = input.existingTasks.filter((task) =>
    isAutomaticStreet(task, input.campaignId, input.areaId)
  );
  const prepared = input.preparedTasks
    .filter((task) => isAutomaticStreet(task, input.campaignId, input.areaId))
    .sort((first, second) => first.id.localeCompare(second.id));
  const existingById = new Map(existing.map((task) => [task.id, task]));
  const preparedById = new Map(prepared.map((task) => [task.id, task]));
  const inserts = prepared.filter((task) => !existingById.has(task.id));
  const unchangedIds = prepared
    .filter((task) => existingById.has(task.id))
    .map((task) => task.id);
  const obsolete = existing.filter((task) => !preparedById.has(task.id));
  const workedTaskIds = obsolete
    .filter((task) => task.status !== "open")
    .map((task) => task.id)
    .sort((first, second) => first.localeCompare(second));

  if (workedTaskIds.length > 0) {
    return { outcome: "blocked-worked", workedTaskIds };
  }

  const deleteIds = obsolete
    .filter((task) => task.status === "open")
    .map((task) => task.id)
    .sort((first, second) => first.localeCompare(second));
  const deleteSet = new Set(deleteIds);
  const afterTasks = input.existingTasks
    .filter((task) => !deleteSet.has(task.id))
    .concat(inserts);

  return {
    outcome: "ready",
    inserts,
    deleteIds,
    unchangedIds,
    afterTasks,
  };
}
