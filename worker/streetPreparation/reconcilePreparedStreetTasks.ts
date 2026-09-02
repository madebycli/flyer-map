import type { DistributionTask } from "../../src/domain/campaign.ts";
import {
  canonicalStreetFragmentGeometryJson,
  stablePreparedStreetTaskId,
} from "./roadIdentity.ts";
import type { PreparedStreetCandidate } from "./types.ts";

export const AUTO_STREET_SERVER_OWNED_FIELDS = [
  "id",
  "campaignId",
  "areaId",
  "taskType",
  "geometry",
  "source",
  "areaPreparationGeneration",
  "updatedAt",
] as const;

export const AUTO_STREET_USER_OWNED_FIELDS = [
  "label",
  "status",
  "completedAt",
  "createdAt",
] as const;

export type PreparedStreetReconcileInput = {
  existingTasks: DistributionTask[];
  preparedTasks: DistributionTask[];
  campaignId: string;
  areaId: string;
};

export type PreparedStreetReconcileReady = {
  outcome: "ready";
  inserts: DistributionTask[];
  updates: DistributionTask[];
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

export type PreparedStreetMaterializationInput = {
  candidates: PreparedStreetCandidate[];
  campaignId: string;
  areaId: string;
  generation: string;
  timestamp: string;
};

function isAutomaticStreet(task: DistributionTask, campaignId: string, areaId: string) {
  return task.campaignId === campaignId
    && task.areaId === areaId
    && task.taskType === "street"
    && typeof task.areaPreparationGeneration === "string"
    && task.areaPreparationGeneration.length > 0;
}

function taskSource(sourceOsmWayId: number) {
  return {
    dataset: "OpenStreetMap" as const,
    objectType: "way" as const,
    objectIds: [sourceOsmWayId],
  };
}

export async function materializePreparedStreetTasks(
  input: PreparedStreetMaterializationInput,
): Promise<DistributionTask[]> {
  const uniqueCandidates: PreparedStreetCandidate[] = [];
  const seenFragmentKeys = new Set<string>();
  for (const candidate of input.candidates) {
    if (seenFragmentKeys.has(candidate.fragmentKey)) continue;
    seenFragmentKeys.add(candidate.fragmentKey);
    uniqueCandidates.push(candidate);
  }
  return Promise.all(uniqueCandidates.map(async (candidate) => ({
    id: await stablePreparedStreetTaskId({
      campaignId: input.campaignId,
      areaId: input.areaId,
      sourceOsmWayId: candidate.sourceOsmWayId,
      geometry: candidate.geometry,
    }),
    campaignId: input.campaignId,
    areaId: input.areaId,
    taskType: "street" as const,
    label: candidate.label,
    geometry: candidate.geometry,
    source: taskSource(candidate.sourceOsmWayId),
    areaPreparationGeneration: input.generation,
    status: "open" as const,
    completedAt: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  } satisfies DistributionTask)));
}

function serverOwnedFieldsChanged(existing: DistributionTask, prepared: DistributionTask) {
  return JSON.stringify(existing.geometry) !== JSON.stringify(prepared.geometry)
    || JSON.stringify(existing.source ?? null) !== JSON.stringify(prepared.source ?? null)
    || existing.areaPreparationGeneration !== prepared.areaPreparationGeneration;
}

function mergePreparedServerFields(
  existing: DistributionTask,
  prepared: DistributionTask,
) {
  if (!serverOwnedFieldsChanged(existing, prepared)) return existing;
  return {
    ...prepared,
    label: existing.label,
    status: existing.status,
    completedAt: existing.completedAt,
    createdAt: existing.createdAt,
    updatedAt: prepared.updatedAt,
  } satisfies DistributionTask;
}

export function reconcilePreparedStreetTasks(
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
  const updates: DistributionTask[] = [];
  const inserts = prepared.filter((task) => !existingById.has(task.id));
  const unchangedIds: string[] = [];

  for (const preparedTask of prepared) {
    const existingTask = existingById.get(preparedTask.id);
    if (!existingTask) continue;
    const merged = mergePreparedServerFields(existingTask, preparedTask);
    if (merged === existingTask) {
      unchangedIds.push(existingTask.id);
    } else {
      updates.push(merged);
    }
  }

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
  const updatesById = new Map(updates.map((task) => [task.id, task]));
  const afterTasks = input.existingTasks
    .filter((task) => !deleteSet.has(task.id))
    .map((task) => updatesById.get(task.id) ?? task)
    .concat(inserts);

  return {
    outcome: "ready",
    inserts,
    updates,
    deleteIds,
    unchangedIds: unchangedIds.sort((first, second) => first.localeCompare(second)),
    afterTasks,
  };
}

export { canonicalStreetFragmentGeometryJson };
