import type { DistributionTask, LineStringGeometry } from "../../src/domain/campaign.ts";
import nearestPointOnLine from '@turf/nearest-point-on-line';
import { roadSlice, setCoverage } from '../../src/domain/streetNetwork.ts';

export const AREA_STREET_PREPARATION_ALGORITHM_VERSION = "street-network-v4-addressed";

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
      updates: DistributionTask[];
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

export async function sha256Hex(value: string) {
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
  preparedTasks?: DistributionTask[];
  allowRemovedWork?: boolean;
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

  for (const task of input.preparedTasks ?? []) preparedById.set(task.id, task);

  const existingAutomatic = input.existingTasks.filter(
    (task) => task.areaId === input.areaId && task.areaPreparationGeneration !== null,
  );
  const existingById = new Map(existingAutomatic.map((task) => [task.id, task]));
  const workedTaskIds = existingAutomatic
    .filter((task) => !preparedById.has(task.id) && task.status !== "open")
    .map((task) => task.id)
    .sort();
  if (workedTaskIds.length > 0 && !input.allowRemovedWork) {
    return { outcome: "blocked-worked", workedTaskIds };
  }

  const inserts: DistributionTask[] = [];
  const updates: DistributionTask[] = [];
  const unchangedIds: string[] = [];
  const reconciledAutomatic: DistributionTask[] = [];
  for (const prepared of preparedById.values()) {
    const existing = existingById.get(prepared.id);
    if (existing) {
      const next: DistributionTask = {
        ...prepared, label: existing.label, status: existing.status,
        completedAt: existing.completedAt, createdAt: existing.createdAt,
        ...(prepared.network ? { network: { ...prepared.network, coverage: existing.network?.coverage ?? [] } } : {}),
      };
      if (JSON.stringify({...next, updatedAt: existing.updatedAt}) === JSON.stringify(existing)) {
        reconciledAutomatic.push(existing);
        unchangedIds.push(existing.id);
      } else {
        reconciledAutomatic.push(next);
        updates.push(next);
      }
    } else {
      let next=prepared;
      if(input.allowRemovedWork&&prepared.network){
        let coverage=prepared.network.coverage;
        let inherited:DistributionTask|undefined;
        for(const old of existingAutomatic){
          if(!old.network?.coverage.length||!old.source?.objectIds.some(id=>prepared.source?.objectIds.includes(id)))continue;
          for(const range of old.network.coverage){
            const line=roadSlice(old.geometry,range.from,range.to);
            const points:number[]=[];
            for(const point of [line.coordinates[0],line.coordinates.at(-1)!]){
              const snap=nearestPointOnLine(prepared.geometry,point,{units:'meters'});
              if(snap.properties.dist<0.5)points.push(snap.properties.location);
            }
            for(const [point,measure] of [[prepared.geometry.coordinates[0],0],[prepared.geometry.coordinates.at(-1)!,prepared.network.length]] as const){
              if(nearestPointOnLine(line,point,{units:'meters'}).properties.dist<0.5)points.push(measure);
            }
            if(points.length>=2){const from=Math.max(0,Math.min(...points)),to=Math.min(prepared.network.length,Math.max(...points));if(to-from>0.001){coverage=setCoverage(coverage,from,to,range.status,prepared.network.length);inherited=old;}}
          }
        }
        if(inherited){const full=coverage.length===1&&coverage[0].from<0.001&&coverage[0].to>=prepared.network.length-0.001;const status=full?coverage[0].status:'open';next={...prepared,label:inherited.label,createdAt:inherited.createdAt,network:{...prepared.network,coverage},status,completedAt:status==='completed'?inherited.completedAt:null};}
      }
      reconciledAutomatic.push(next);
      inserts.push(next);
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
    updates,
    deleteIds,
    unchangedIds: unchangedIds.sort(),
  };
}
