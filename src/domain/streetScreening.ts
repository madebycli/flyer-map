import type { DistributionTask, HouseTask, LngLat } from './campaign.ts';
import { RoadIndex, type RoadNetwork } from './streetNetwork.ts';

export type StreetScreeningMode = 'classic' | 'delivery-v2' | 'delivery-v3';

export type StreetScreeningReason =
  | 'classic'
  | 'manual_or_legacy'
  | 'serves_houses'
  | 'named_or_referenced'
  | 'unnamed_without_houses'
  | 'v3_test_candidate'
  | 'roundabout_connector'
  | 'address_access';

export type StreetScreeningDecision = {
  taskId: string;
  visible: boolean;
  reason: StreetScreeningReason;
  houseCount: number;
};

export type StreetScreeningResult = {
  tasks: DistributionTask[];
  decisions: StreetScreeningDecision[];
  hiddenTaskIds: string[];
};

type StreetMetadata = {
  highway: string;
  service?: string;
  junction?: string;
  access?: string;
  deliveryClass?: 'classic' | 'address-access-candidate';
};
type V3RoadNetwork = RoadNetwork & { street?: StreetMetadata };

const V3_HOUSE_ACCESS_RADIUS_METERS = 40;
const V3_BASE_CONNECTION_RADIUS_METERS = 3;
const V3_MAX_ACCESS_PATH_METERS = 220;

function normalizedLabel(label: string) {
  return label.normalize('NFKC').toLocaleLowerCase('de').replace(/[\s.]+/g, ' ').trim();
}

function isGenericUnnamedLabel(label: string) {
  return ['straße', 'strasse', 'street'].includes(normalizedLabel(label));
}

function streetMetadata(task: DistributionTask): StreetMetadata | null {
  return ((task.network as V3RoadNetwork | undefined)?.street) ?? null;
}

/** V3-only roads are persisted in the canonical graph but remain invisible in V1/V2. */
export function isDeliveryV3AccessCandidateTask(task: DistributionTask) {
  return streetMetadata(task)?.deliveryClass === 'address-access-candidate';
}

function v2Decision(task: DistributionTask, houseCount: number): StreetScreeningDecision {
  if (isDeliveryV3AccessCandidateTask(task)) {
    return { taskId: task.id, visible: false, reason: 'v3_test_candidate', houseCount };
  }
  if (!task.network || !task.areaPreparationGeneration) {
    return { taskId: task.id, visible: true, reason: 'manual_or_legacy', houseCount };
  }
  if (houseCount > 0) {
    return { taskId: task.id, visible: true, reason: 'serves_houses', houseCount };
  }
  if (!isGenericUnnamedLabel(task.label)) {
    return { taskId: task.id, visible: true, reason: 'named_or_referenced', houseCount };
  }
  return { taskId: task.id, visible: false, reason: 'unnamed_without_houses', houseCount };
}

function sourceWayKey(task: DistributionTask) {
  const id = task.source?.objectIds[0];
  return Number.isSafeInteger(id) ? `${task.areaId}:${id}` : null;
}

/**
 * Exact V3 metadata wins. For generations created before V3 metadata existed,
 * a same-source closed network cycle is a conservative roundabout fallback.
 */
function roundaboutTaskIds(tasks: DistributionTask[]) {
  const result = new Set<string>();
  const bySource = new Map<string, DistributionTask[]>();
  for (const task of tasks) {
    if (streetMetadata(task)?.junction === 'roundabout') result.add(task.id);
    const key = sourceWayKey(task);
    if (!key || !task.network) continue;
    bySource.set(key, [...(bySource.get(key) ?? []), task]);
  }
  for (const group of bySource.values()) {
    if (group.length < 2 || group.some((task) => !task.network)) continue;
    const degree = new Map<string, number>();
    for (const task of group) {
      const network = task.network!;
      degree.set(network.fromNode, (degree.get(network.fromNode) ?? 0) + 1);
      degree.set(network.toNode, (degree.get(network.toNode) ?? 0) + 1);
    }
    if (degree.size >= 2 && [...degree.values()].every((value) => value === 2)) {
      group.forEach((task) => result.add(task.id));
    }
  }
  return result;
}

function houseRepresentativePoint(house: HouseTask): LngLat | null {
  const ring = house.geometry.coordinates[0] ?? [];
  if (!ring.length) return null;
  const points = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
    ? ring.slice(0, -1)
    : ring;
  if (!points.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
  }
  if (![minX,maxX,minY,maxY].every(Number.isFinite)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function v3AccessEligible(task: DistributionTask) {
  if (!task.network || !task.areaPreparationGeneration) return false;
  const meta = streetMetadata(task);
  if (!meta) return isGenericUnnamedLabel(task.label);
  if (['no','private'].includes(meta.access ?? '')) return false;
  if (meta.deliveryClass === 'address-access-candidate') return true;
  return isGenericUnnamedLabel(task.label)
    && ['service','residential','living_street','unclassified'].includes(meta.highway);
}

type HeapItem = { node: string; distance: number };
function heapPush(heap: HeapItem[], item: HeapItem) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].distance <= item.distance) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = item;
}
function heapPop(heap: HeapItem[]) {
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child += 1;
      if (heap[child].distance >= last.distance) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  }
  return first;
}

function addV3AccessPaths(
  areaTasks: DistributionTask[],
  areaHouses: HouseTask[],
  visibleIds: Set<string>,
  reasonById: Map<string, StreetScreeningReason>,
) {
  const hiddenCandidates = areaTasks.filter((task) => !visibleIds.has(task.id) && v3AccessEligible(task));
  const baseTasks = areaTasks.filter((task) => visibleIds.has(task.id) && task.network);
  if (!hiddenCandidates.length || !baseTasks.length || !areaHouses.length) return;

  const candidateIndex = new RoadIndex(hiddenCandidates);
  const baseIndex = new RoadIndex(baseTasks);
  const seedIds = new Set<string>();
  for (const house of areaHouses) {
    const point = houseRepresentativePoint(house);
    if (!point) continue;
    try {
      const nearest = candidateIndex.candidates(point, V3_HOUSE_ACCESS_RADIUS_METERS)[0];
      if (nearest) seedIds.add(nearest.task.id);
    } catch {/* malformed legacy geometry remains hidden */}
  }
  if (!seedIds.size) return;

  type Arc = { taskId: string; other: string; length: number };
  const adjacency = new Map<string, Arc[]>();
  const endpointPoint = new Map<string, LngLat>();
  const byId = new Map(hiddenCandidates.map((task) => [task.id, task]));
  const add = (node:string, arc:Arc) => adjacency.set(node,[...(adjacency.get(node) ?? []),arc]);
  for (const task of hiddenCandidates) {
    const network = task.network!;
    endpointPoint.set(network.fromNode, task.geometry.coordinates[0]);
    endpointPoint.set(network.toNode, task.geometry.coordinates.at(-1)!);
    add(network.fromNode,{taskId:task.id,other:network.toNode,length:network.length});
    add(network.toNode,{taskId:task.id,other:network.fromNode,length:network.length});
  }

  // Candidate endpoints may touch the middle of a classic task. Geometric snap
  // therefore defines the V3 display connection without forcing V1/V2 task splits.
  const distance = new Map<string,number>();
  const parent = new Map<string,{node:string;taskId:string}>();
  const heap:HeapItem[]=[];
  for (const [node,point] of endpointPoint) {
    try {
      if (baseIndex.candidates(point,V3_BASE_CONNECTION_RADIUS_METERS).length) {
        distance.set(node,0); heapPush(heap,{node,distance:0});
      }
    } catch {/* no base connection */}
  }
  while (heap.length) {
    const current=heapPop(heap);
    if (current.distance !== distance.get(current.node)) continue;
    for (const arc of adjacency.get(current.node) ?? []) {
      const next=current.distance+arc.length;
      if (next>V3_MAX_ACCESS_PATH_METERS || next >= (distance.get(arc.other) ?? Infinity)) continue;
      distance.set(arc.other,next);
      parent.set(arc.other,{node:current.node,taskId:arc.taskId});
      heapPush(heap,{node:arc.other,distance:next});
    }
  }

  for (const seedId of seedIds) {
    const seed=byId.get(seedId);if(!seed?.network)continue;
    const options=[seed.network.fromNode,seed.network.toNode]
      .map(node=>({node,distance:distance.get(node)??Infinity}))
      .sort((a,b)=>a.distance-b.distance);
    const best=options[0];
    if(!Number.isFinite(best.distance) || seed.network.length+best.distance>V3_MAX_ACCESS_PATH_METERS)continue;
    visibleIds.add(seed.id);reasonById.set(seed.id,'address_access');
    let node=best.node;const visited=new Set<string>();
    for(let steps=0;steps<hiddenCandidates.length && !visited.has(node);steps++){
      visited.add(node);
      const step=parent.get(node);if(!step)break;
      visibleIds.add(step.taskId);reasonById.set(step.taskId,'address_access');
      node=step.node;
    }
  }
}

/**
 * V1 and V2 remain reversible views. V3 is an explicit test view which adds
 * structural roundabouts and only the short hidden access path needed to reach
 * a nearby House. The canonical prepared graph is never destructively filtered.
 */
export function screenDistributionStreets(
  tasks: DistributionTask[],
  houses: HouseTask[],
  mode: StreetScreeningMode,
): StreetScreeningResult {
  const houseCountByStreet = new Map<string, number>();
  for (const house of houses) {
    if (!house.parentStreetTaskId) continue;
    houseCountByStreet.set(house.parentStreetTaskId,(houseCountByStreet.get(house.parentStreetTaskId) ?? 0) + 1);
  }

  if (mode === 'classic') {
    const decisions = tasks.map((task):StreetScreeningDecision => {
      const houseCount=houseCountByStreet.get(task.id)??0;
      return isDeliveryV3AccessCandidateTask(task)
        ? {taskId:task.id,visible:false,reason:'v3_test_candidate',houseCount}
        : {taskId:task.id,visible:true,reason:'classic',houseCount};
    });
    const hiddenTaskIds=decisions.filter((decision)=>!decision.visible).map((decision)=>decision.taskId);
    const hidden=new Set(hiddenTaskIds);
    return {tasks:tasks.filter((task)=>!hidden.has(task.id)),decisions,hiddenTaskIds};
  }

  const decisions = tasks.map((task)=>v2Decision(task,houseCountByStreet.get(task.id)??0));
  if (mode === 'delivery-v3') {
    const decisionById=new Map(decisions.map((decision)=>[decision.taskId,decision]));
    const tasksByArea=new Map<string,DistributionTask[]>();
    const housesByArea=new Map<string,HouseTask[]>();
    for(const task of tasks)tasksByArea.set(task.areaId,[...(tasksByArea.get(task.areaId)??[]),task]);
    for(const house of houses)housesByArea.set(house.areaId,[...(housesByArea.get(house.areaId)??[]),house]);
    for(const [areaId,areaTasks] of tasksByArea){
      const visibleIds=new Set(areaTasks.filter((task)=>decisionById.get(task.id)?.visible).map((task)=>task.id));
      const reasonById=new Map(areaTasks.map((task)=>[task.id,decisionById.get(task.id)!.reason]));
      for(const id of roundaboutTaskIds(areaTasks)){visibleIds.add(id);reasonById.set(id,'roundabout_connector');}
      addV3AccessPaths(areaTasks,housesByArea.get(areaId)??[],visibleIds,reasonById);
      for(const task of areaTasks){
        const prior=decisionById.get(task.id)!;
        decisionById.set(task.id,{...prior,visible:visibleIds.has(task.id),reason:reasonById.get(task.id)??prior.reason});
      }
    }
    decisions.splice(0,decisions.length,...tasks.map((task)=>decisionById.get(task.id)!));
  }

  const hiddenTaskIds = decisions.filter((decision) => !decision.visible).map((decision) => decision.taskId);
  const hidden = new Set(hiddenTaskIds);
  return { tasks: tasks.filter((task) => !hidden.has(task.id)), decisions, hiddenTaskIds };
}
