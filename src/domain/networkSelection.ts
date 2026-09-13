import type { DistributionTask, LngLat, TaskStatus } from './campaign.ts';
import { RoadIndex, snapNetworkPoint, networkRoutes, type NetworkRoute, type RoadRange } from './streetNetwork.ts';

export const MAX_NETWORK_POINTS = 32;
export const MAX_NETWORK_RANGES = 500;
export type NetworkAnchor = { point: LngLat; taskId: string };
export type NetworkIntent = {
  id: string; areaId: string; generation: string;
  start: NetworkAnchor; end: NetworkAnchor; selectedPath: string[]; status: TaskStatus;
  via?: NetworkAnchor[]; paths?: string[][]; expectedState?: string;
};

export function joinNetworkRoutes(routes: NetworkRoute[]): NetworkRoute | null {
  if (!routes.length) return null;
  const ranges = routes.flatMap(route => route.ranges);
  if (ranges.length > MAX_NETWORK_RANGES) throw new Error('network_route_budget_exceeded');
  return {
    ranges, length: routes.reduce((sum, route) => sum + route.length, 0),
    geometry: { type: 'LineString', coordinates: routes.flatMap((route, i) => i ? route.geometry.coordinates.slice(1) : route.geometry.coordinates) },
  };
}

/** Recompute every leg; user waypoints are mandatory, never global shortest-path hints. */
export function resolveNetworkIntent(tasks: DistributionTask[], intent: NetworkIntent): NetworkRoute {
  const anchors = [intent.start, ...(intent.via ?? []), intent.end];
  const paths = intent.paths ?? [intent.selectedPath];
  if (anchors.length > MAX_NETWORK_POINTS || paths.length !== anchors.length - 1 || JSON.stringify(paths.flat()) !== JSON.stringify(intent.selectedPath)) throw new Error('network_route_changed');
  const index = new RoadIndex(tasks);
  const snaps = anchors.map(anchor => snapNetworkPoint(index, anchor.point, anchor.taskId));
  const legs = paths.map((path, i) => {
    const route = networkRoutes(tasks, snaps[i], snaps[i + 1]).find(route => JSON.stringify(route.ranges.map(range => range.taskId)) === JSON.stringify(path));
    if (!route) throw new Error('network_route_changed');
    return route;
  });
  const result = joinNetworkRoutes(legs);
  if (!result) throw new Error('network_route_changed');
  return result;
}

/** Conservative per-road conflict check. No unrelated Campaign revision or client timestamp. */
export async function networkSelectionState(tasks: DistributionTask[], ranges: RoadRange[]): Promise<string> {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const state = [...new Set(ranges.map(range => range.taskId))].sort().map(id => {
    const task = byId.get(id);
    if (!task?.network) throw new Error('network_edge_missing');
    const network = task.network;
    return [id, task.areaPreparationGeneration, task.geometry.coordinates, network.fromNode, network.toNode, network.length, network.coverage.map(range => [range.from, range.to, range.status])];
  });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
