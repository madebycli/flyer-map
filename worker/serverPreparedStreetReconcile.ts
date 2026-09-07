import type { DistributionTask, LineStringGeometry } from "../src/domain/campaign.ts";

export const AREA_STREET_PREPARATION_ALGORITHM_VERSION = "street-v1";

export const AUTO_STREET_SERVER_OWNED_FIELDS = [
  "id",
  "campaignId",
  "areaId",
  "taskType",
  "geometry",
  "source",
  "areaPreparationGeneration",
] as const;

// Street labels are user-editable through task.rename, so an existing stable
// entity keeps its label together with the other user-owned work state.
export const AUTO_STREET_USER_OWNED_FIELDS = [
  "label",
  "status",
  "completedAt",
  "createdAt",
] as const;

export type PreparedStreetCandidate = {
  sourceOsmWayId: number;
  label: string;
  geometry: LineStringGeometry;
};

export type ServerPreparedStreetReconcilePlan =
  | {
      outcome: "ready";
      afterTasks: DistributionTask[];
      inserts: DistributionTask[];
      deleteIds: string[];
      unchangedIds: string[];
    }
  | {
      outcome: "blocked-worked";
      workedTaskIds: string[];
    };

function canonicalCoordinates(geometry: LineStringGeometry) {
  const forward = geometry.coordinates;
  const reversed = [...forward].reverse();
  const forwardJson = JSON.stringify(forward);
  const reversedJson = JSON.stringify(reversed);
  return reversedJson < forwardJson ? reversed : forward;
}

export function canonicalStreetFragmentGeometryJson(geometry: LineStringGeometry) {
  return JSON.stringify({ type: "LineString", coordinates: canonicalCoordinates(geometry) });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function stablePreparedStreetTaskId(input: {
  campaignId: string;
  areaId: string;
  sourceOsmWayId: number;
  geometry: LineStringGeometry;
}) {
  const identity = JSON.stringify({
    namespace: "server-prepared-street-v1",
    campaignId: input.campaignId,
    areaId: input.areaId,
    sourceOsmWayId: input.sourceOsmWayId,
    geometry: canonicalStreetFragmentGeometryJson(input.geometry),
  });
  return `task_auto_${await sha256Hex(identity)}`;
}

export async function areaStreetPreparationFingerprint(
  canonicalAreaGeometryJson: string,
  algorithmVersion = AREA_STREET_PREPARATION_ALGORITHM_VERSION,
) {
  return sha256Hex(JSON.stringify({ algorithmVersion, canonicalAreaGeometryJson }));
}

async function materializePreparedStreet(input: {
  candidate: PreparedStreetCandidate;
  campaignId: string;
  areaId: string;
  generation: string;
  timestamp: string;
}): Promise<DistributionTask> {
  return {
    id: await stablePreparedStreetTaskId({
      campaignId: input.campaignId,
      areaId: input.areaId,
      sourceOsmWayId: input.candidate.sourceOsmWayId,
      geometry: input.candidate.geometry,
    }),
    campaignId: input.campaignId,
    areaId: input.areaId,
    taskType: "street",
    label: input.candidate.label,
    geometry: input.candidate.geometry,
    source: {
      dataset: "OpenStreetMap",
      objectType: "way",
      objectIds: [input.candidate.sourceOsmWayId],
    },
    areaPreparationGeneration: input.generation,
    status: "open",
    completedAt: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export async function reconcileServerPreparedStreetTasks(input: {
  existingTasks: DistributionTask[];
  preparedFragments: PreparedStreetCandidate[];
  campaignId: string;
  areaId: string;
  generation: string;
  timestamp: string;
}): Promise<ServerPreparedStreetReconcilePlan> {
  const preparedById = new Map<string, DistributionTask>();
  for (const candidate of input.preparedFragments) {
    const prepared = await materializePreparedStreet({
      candidate,
      campaignId: input.campaignId,
      areaId: input.areaId,
      generation: input.generation,
      timestamp: input.timestamp,
    });
    if (!preparedById.has(prepared.id)) preparedById.set(prepared.id, prepared);
  }

  const existingAutomatic = input.existingTasks.filter(
    (task) => task.areaId === input.areaId && task.areaPreparationGeneration !== null,
  );
  const existingById = new Map(existingAutomatic.map((task) => [task.id, task]));
  const workedTaskIds = existingAutomatic
    .filter((task) => !preparedById.has(task.id) && task.status !== "open")
    .map((task) => task.id)
    .sort();
  if (workedTaskIds.length > 0) {
    return { outcome: "blocked-worked", workedTaskIds };
  }

  const inserts: DistributionTask[] = [];
  const unchangedIds: string[] = [];
  const reconciledAutomatic: DistributionTask[] = [];
  for (const prepared of preparedById.values()) {
    const existing = existingById.get(prepared.id);
    if (existing) {
      // Same deterministic identity means the server-owned geometry/source are
      // semantically unchanged. Keep the exact persisted entity to avoid feed
      // churn and to preserve label/status/completedAt/createdAt.
      reconciledAutomatic.push(existing);
      unchangedIds.push(existing.id);
    } else {
      reconciledAutomatic.push(prepared);
      inserts.push(prepared);
    }
  }

  const deleteIds = existingAutomatic
    .filter((task) => !preparedById.has(task.id) && task.status === "open")
    .map((task) => task.id)
    .sort();
  const deleteIdSet = new Set(deleteIds);
  const unaffected = input.existingTasks.filter((task) =>
    !(task.areaId === input.areaId && task.areaPreparationGeneration !== null) &&
    !deleteIdSet.has(task.id),
  );

  return {
    outcome: "ready",
    afterTasks: [...unaffected, ...reconciledAutomatic],
    inserts,
    deleteIds,
    unchangedIds: unchangedIds.sort(),
  };
}
