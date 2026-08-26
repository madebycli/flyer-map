import type { SmartRoadCandidate } from "./smartCandidates.ts";

type Coordinate = [number, number];

export type SmartRoadRangeSelection =
  | { state: "selected"; sourceIds: string[] }
  | { state: "disconnected"; sourceIds: [] }
  | { state: "ambiguous"; sourceIds: [] };

export type SmartRoadRouteOption = {
  sourceIds: string[];
};

type PathSearchResult = {
  paths: string[][];
  truncated: boolean;
};

function coordinateKey([lng, lat]: Coordinate) {
  return `${lng.toFixed(7)},${lat.toFixed(7)}`;
}

function endpointKeys(candidate: SmartRoadCandidate) {
  const coordinates = candidate.geometry.coordinates;
  if (coordinates.length === 0) return new Set<string>();
  return new Set([
    coordinateKey(coordinates[0]),
    coordinateKey(coordinates[coordinates.length - 1]),
  ]);
}

function candidatesTouch(a: SmartRoadCandidate, b: SmartRoadCandidate) {
  const aEndpoints = endpointKeys(a);
  const bEndpoints = endpointKeys(b);
  for (const endpoint of aEndpoints) {
    if (bEndpoints.has(endpoint)) return true;
  }
  return false;
}

function adjacencyFor(roads: SmartRoadCandidate[]) {
  const adjacency = new Map<string, string[]>();
  for (const road of roads) adjacency.set(road.sourceId, []);

  for (let index = 0; index < roads.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < roads.length; otherIndex += 1) {
      const first = roads[index];
      const second = roads[otherIndex];
      if (!candidatesTouch(first, second)) continue;
      adjacency.get(first.sourceId)?.push(second.sourceId);
      adjacency.get(second.sourceId)?.push(first.sourceId);
    }
  }

  return adjacency;
}

function findShortestPaths(
  adjacency: Map<string, string[]>,
  startSourceId: string,
  endSourceId: string,
  pathLimit: number,
): PathSearchResult {
  const paths: string[][] = [];
  const queue: string[][] = [[startSourceId]];
  const graphSize = Math.max(1, adjacency.size);
  const expansionLimit = Math.max(500, Math.min(10_000, graphSize * 20));
  let expansions = 0;
  let shortestLength: number | null = null;

  while (queue.length > 0 && paths.length < pathLimit) {
    if (expansions >= expansionLimit) return { paths, truncated: true };
    expansions += 1;

    const path = queue.shift();
    if (!path) break;
    if (shortestLength !== null && path.length > shortestLength) break;

    const current = path[path.length - 1];
    if (current === endSourceId) {
      shortestLength ??= path.length;
      paths.push(path);
      continue;
    }
    if (shortestLength !== null) continue;

    for (const neighbor of adjacency.get(current) ?? []) {
      if (path.includes(neighbor)) continue;
      queue.push([...path, neighbor]);
    }
  }

  return { paths, truncated: false };
}

function knownSourceIds(roads: SmartRoadCandidate[]) {
  return new Set(roads.map((road) => road.sourceId));
}

export function selectSmartRoadRange(
  roads: SmartRoadCandidate[],
  startSourceId: string,
  endSourceId: string,
): SmartRoadRangeSelection {
  const sourceIds = knownSourceIds(roads);
  if (!sourceIds.has(startSourceId) || !sourceIds.has(endSourceId)) {
    return { state: "disconnected", sourceIds: [] };
  }
  if (startSourceId === endSourceId) {
    return { state: "selected", sourceIds: [startSourceId] };
  }

  const search = findShortestPaths(adjacencyFor(roads), startSourceId, endSourceId, 2);
  if (search.paths.length === 0 && !search.truncated) return { state: "disconnected", sourceIds: [] };
  if (search.truncated || search.paths.length > 1) return { state: "ambiguous", sourceIds: [] };
  return { state: "selected", sourceIds: search.paths[0] };
}

export function smartRoadRouteOptions(
  roads: SmartRoadCandidate[],
  startSourceId: string,
  endSourceId: string,
  limit = 3,
): SmartRoadRouteOption[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) return [];
  const sourceIds = knownSourceIds(roads);
  if (!sourceIds.has(startSourceId) || !sourceIds.has(endSourceId)) return [];
  if (startSourceId === endSourceId) return [{ sourceIds: [startSourceId] }];

  return findShortestPaths(adjacencyFor(roads), startSourceId, endSourceId, limit).paths.map(
    (sourceIdsForRoute) => ({ sourceIds: sourceIdsForRoute }),
  );
}

export function selectSmartRoadRangeViaWaypoints(
  roads: SmartRoadCandidate[],
  anchorSourceIds: string[],
): SmartRoadRangeSelection {
  if (anchorSourceIds.length < 2) return { state: "disconnected", sourceIds: [] };

  const merged: string[] = [];
  for (let index = 0; index < anchorSourceIds.length - 1; index += 1) {
    const leg = selectSmartRoadRange(roads, anchorSourceIds[index], anchorSourceIds[index + 1]);
    if (leg.state !== "selected") return leg;
    for (const sourceId of leg.sourceIds) {
      if (merged[merged.length - 1] !== sourceId) merged.push(sourceId);
    }
  }

  return { state: "selected", sourceIds: merged };
}

export function smartRoadSelectionLabel(roads: SmartRoadCandidate[], sourceIds: string[]) {
  if (sourceIds.length === 0) return null;
  const selected = roads.filter((candidate) => sourceIds.includes(candidate.sourceId));
  if (selected.length === 1) {
    return selected[0].name?.trim() || selected[0].ref || selected[0].sourceId;
  }
  return `${selected.length} Straßenabschnitte`;
}
