import nearestPointOnLine from '@turf/nearest-point-on-line';
import lineSliceAlong from '@turf/line-slice-along';
import length from '@turf/length';
import RBush from 'rbush';
import type { DistributionTask, HouseTask, LineStringGeometry, LngLat, TaskStatus } from './campaign.ts';

export type CoverageRange = { from: number; to: number; status: TaskStatus };
export type RoadNetwork = { fromNode: string; toNode: string; length: number; coverage: CoverageRange[] };
export type HouseRoadPosition = { measure: number | null; confidence: 'address' | 'nearby' | 'unassigned' };
export type RoadRange = { taskId: string; from: number; to: number };
export type NetworkRoute = { ranges: RoadRange[]; geometry: LineStringGeometry; length: number };
export const networkNodeKey = (point: LngLat, level = '0') => `${level}:${point[0].toFixed(9)},${point[1].toFixed(9)}`;
export const roadLength = (geometry: LineStringGeometry) => length({ type: 'Feature', properties: {}, geometry }, { units: 'meters' });
export function roadSlice(geometry: LineStringGeometry, from: number, to: number): LineStringGeometry {
  const result = lineSliceAlong(geometry, Math.min(from, to), Math.max(from, to), { units: 'meters' });
  const coordinates = result.geometry.coordinates as LngLat[];
  return { type: 'LineString', coordinates: from > to ? coordinates.reverse() : coordinates };
}

/** Replace only the requested interval, preserving disjoint work and coalescing neighbours. */
export function setCoverage(existing: CoverageRange[], from: number, to: number, status: TaskStatus, total: number) {
  [from, to] = [Math.min(from, to), Math.max(from, to)];
  if (![from, to, total].every(Number.isFinite) || from < 0 || to > total + 0.001 || to - from < 0.001) throw new Error('invalid_coverage_range');
  to = Math.min(total, to);
  const result: CoverageRange[] = [];
  for (const range of existing) {
    if (range.to <= from || range.from >= to) result.push({ ...range });
    else {
      if (range.from < from) result.push({ ...range, to: from });
      if (range.to > to) result.push({ ...range, from: to });
    }
  }
  if (status !== 'open') result.push({ from, to, status });
  result.sort((a, b) => a.from - b.from);
  const merged: CoverageRange[] = [];
  for (const range of result) {
    const last = merged.at(-1);
    if (last && last.status === range.status && Math.abs(last.to - range.from) < 0.001) last.to = range.to;
    else merged.push(range);
  }
  if (merged.length > 2048) throw new Error('coverage_budget_exceeded');
  return merged;
}

type IndexedSegment = { minX: number; minY: number; maxX: number; maxY: number; task: DistributionTask; segment: number; offset: number };
export type RoadSnap = { task: DistributionTask; measure: number; point: LngLat; distance: number };
export class RoadIndex {
  private tree = new RBush<IndexedSegment>();
  constructor(tasks: DistributionTask[]) {
    const entries: IndexedSegment[] = [];
    for (const task of tasks) {
      if (!task.network) continue;
      let offset = 0;
      for (let i = 1; i < task.geometry.coordinates.length; i++) {
        const a = task.geometry.coordinates[i - 1], b = task.geometry.coordinates[i];
        entries.push({ minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]), task, segment: i - 1, offset });
        offset += roadLength({ type: 'LineString', coordinates: [a, b] });
      }
    }
    this.tree.load(entries);
  }
  candidates(point: LngLat, radius = 45): RoadSnap[] {
    if (!point.every(Number.isFinite) || Math.abs(point[1]) > 85 || radius > 150) throw new Error('invalid_snap');
    const dy = radius / 110000, dx = dy / Math.cos(point[1] * Math.PI / 180);
    const entries = this.tree.search({ minX: point[0] - dx, maxX: point[0] + dx, minY: point[1] - dy, maxY: point[1] + dy });
    const candidates = new Map<string, RoadSnap>();
    for (const entry of entries) {
      const coords = entry.task.geometry.coordinates.slice(entry.segment, entry.segment + 2);
      const snap = nearestPointOnLine({ type: 'LineString', coordinates: coords }, point, { units: 'meters' });
      const distance = snap.properties.dist;
      if (distance > radius) continue;
      const prior = candidates.get(entry.task.id);
      if (!prior || prior.distance > distance) candidates.set(entry.task.id, { task: entry.task, measure: entry.offset + snap.properties.location, point: snap.geometry.coordinates as LngLat, distance });
    }
    return [...candidates.values()].sort((a, b) => a.distance - b.distance || a.task.id.localeCompare(b.task.id));
  }
}

/** Explicit edge selector disambiguates parallel roads, but cannot override the snap radius. */
export function snapNetworkPoint(index: RoadIndex, point: LngLat, taskId?: string) {
  const candidates = index.candidates(point);
  if (taskId) {
    const selected = candidates.find((candidate) => candidate.task.id === taskId);
    if (!selected) throw new Error('network_snap_missing');
    return selected;
  }
  if (!candidates.length) throw new Error('network_snap_missing');
  if (candidates[1] && candidates[1].distance - candidates[0].distance < 1) throw new Error('network_snap_ambiguous');
  return candidates[0];
}

type Arc = { node: string; range: RoadRange; length: number };
/** Bounded simple-path search; truncated searches fail closed instead of hiding ambiguity. */
export function networkRoutes(tasks: DistributionTask[], start: RoadSnap, end: RoadSnap): NetworkRoute[] {
  if (start.task.areaId !== end.task.areaId) throw new Error('network_area_mismatch');
  if (start.task.id === end.task.id && Math.abs(start.measure - end.measure) < 0.05) return [];
  const adjacency = new Map<string, Arc[]>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const add = (from: string, arc: Arc) => adjacency.set(from, [...(adjacency.get(from) ?? []), arc]);
  let startNode = '@start', endNode = '@end';
  for (const task of tasks) {
    const network = task.network;
    if (!network || task.areaId !== start.task.areaId) continue;
    const cuts = [{ at: 0, node: network.fromNode }, { at: network.length, node: network.toNode }];
    for (const [snap, key] of [[start, '@start'], [end, '@end']] as const) {
      if (snap.task.id !== task.id) continue;
      const endpoint = snap.measure < 0.001 ? network.fromNode : network.length - snap.measure < 0.001 ? network.toNode : key;
      if (key === '@start') startNode = endpoint; else endNode = endpoint;
      if (endpoint === key) cuts.push({ at: snap.measure, node: key });
    }
    cuts.sort((a, b) => a.at - b.at);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i];
      if (b.at - a.at < 0.001) continue;
      add(a.node, { node: b.node, length: b.at - a.at, range: { taskId: task.id, from: a.at, to: b.at } });
      add(b.node, { node: a.node, length: b.at - a.at, range: { taskId: task.id, from: b.at, to: a.at } });
    }
  }
  type Path = { node: string; arcs: Arc[]; length: number };
  const edgeKey = (arc: Arc) => `${arc.range.taskId}:${Math.min(arc.range.from,arc.range.to)}:${Math.max(arc.range.from,arc.range.to)}`;
  const shortest = (banned: string | null): Path | null => {
    const heap: {node:string;length:number}[] = [];
    const push = (item:{node:string;length:number}) => {
      heap.push(item);let i=heap.length-1;
      while(i){const parent=(i-1)>>1;if(heap[parent].length<=item.length)break;heap[i]=heap[parent];i=parent;}heap[i]=item;
    };
    const pop = () => {
      const result=heap[0],last=heap.pop()!;
      if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].length<heap[child].length)child++;if(heap[child].length>=last.length)break;heap[i]=heap[child];i=child;}heap[i]=last;}return result;
    };
    const distance = new Map<string,number>([[startNode,0]]);
    const previous = new Map<string,{node:string;arc:Arc}>();
    push({node:startNode,length:0});let expansions=0;
    while(heap.length){
      const current=pop();if(current.length!==distance.get(current.node))continue;
      if(++expansions>100000)throw new Error('network_route_budget_exceeded');
      if(current.node===endNode){
        const arcs:Arc[]=[];let node=endNode;
        while(node!==startNode){const step=previous.get(node)!;arcs.push(step.arc);node=step.node;}
        return {node:endNode,arcs:arcs.reverse(),length:current.length};
      }
      for(const arc of adjacency.get(current.node)??[]){
        if(edgeKey(arc)===banned)continue;
        const next=current.length+arc.length;
        if(next >= (distance.get(arc.node)??Infinity))continue;
        distance.set(arc.node,next);previous.set(arc.node,{node:current.node,arc});push({node:arc.node,length:next});
      }
    }
    return null;
  };
  const primary=shortest(null);
  if(!primary || !primary.arcs.length)return [];
  if(primary.arcs.length>500)throw new Error('network_route_budget_exceeded');
  const unique=new Map<string,Path>();
  const key=(path:Path)=>path.arcs.map(edgeKey).join('|');
  unique.set(key(primary),primary);
  // Each alternative must omit at least one primary arc. Bounded Dijkstra
  // avoids enumerating exponentially many simple paths in city grids.
  for(const arc of primary.arcs){
    const alternative=shortest(edgeKey(arc));
    if(alternative && alternative.length<=primary.length*1.5+20 && alternative.arcs.length<=500)unique.set(key(alternative),alternative);
  }
  const found=[...unique.values()].sort((a,b)=>a.length-b.length||key(a).localeCompare(key(b))).slice(0,3);
  return found.map((path) => {
    const coordinates: LngLat[] = [];
    for (const arc of path.arcs) {
      const slice = roadSlice(byId.get(arc.range.taskId)!.geometry, arc.range.from, arc.range.to);
      coordinates.push(...(coordinates.length ? slice.coordinates.slice(1) : slice.coordinates));
    }
    return { ranges: path.arcs.map((arc) => arc.range), geometry: { type: 'LineString', coordinates }, length: path.length };
  });
}

export function applyNetworkCoverage(tasks: DistributionTask[], houses: HouseTask[], ranges: RoadRange[], status: TaskStatus, timestamp: string) {
  const byTask = new Map<string, RoadRange[]>();
  for (const range of ranges) byTask.set(range.taskId, [...(byTask.get(range.taskId) ?? []), range]);
  const changedTasks = tasks.map((task) => {
    const selected = byTask.get(task.id);
    if (!selected) return task;
    if (!task.network) throw new Error('network_edge_missing');
    let coverage = task.network.coverage;
    for (const range of selected) coverage = setCoverage(coverage, range.from, range.to, status, task.network.length);
    const full = coverage.length === 1 && coverage[0].from < 0.001 && coverage[0].to >= task.network.length - 0.001;
    const aggregate = full ? coverage[0].status : 'open';
    return { ...task, network: { ...task.network, coverage }, status: aggregate, completedAt: aggregate === 'completed' ? timestamp : null, updatedAt: timestamp };
  });
  const changedHouses = houses.map((house) => {
    const selected = house.parentStreetTaskId ? byTask.get(house.parentStreetTaskId) : undefined;
    const measure = house.roadPosition?.measure;
    if (status !== 'completed' || house.status !== 'open' || measure == null || !selected?.some((range) => measure >= Math.min(range.from, range.to) && measure <= Math.max(range.from, range.to))) return house;
    return { ...house, status: 'completed' as const, completedAt: timestamp, updatedAt: timestamp };
  });
  return { tasks: changedTasks, houseTasks: changedHouses };
}

export function networkProgress(tasks: DistributionTask[], houses: HouseTask[]) {
  const totalLength = tasks.reduce((sum, task) => sum + (task.network?.length ?? roadLength(task.geometry)), 0);
  const completedLength = tasks.reduce((sum, task) => sum + (task.network ? task.network.coverage.filter((range) => range.status === 'completed').reduce((n, range) => n + range.to - range.from, 0) : task.status === 'completed' ? roadLength(task.geometry) : 0), 0);
  return { basis: houses.length ? 'houses' : 'road-coverage', percent: houses.length ? houses.filter((house) => house.status === 'completed').length / houses.length * 100 : totalLength ? completedLength / totalLength * 100 : 0, totalHouses: houses.length, totalLength, completedLength };
}
