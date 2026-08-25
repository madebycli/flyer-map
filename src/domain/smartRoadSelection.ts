import type { SmartRoadCandidate } from "./smartCandidates.ts";

type Coordinate = [number, number];

export type SmartRoadRangeSelection =
  | { state: "selected"; sourceIds: string[] }
  | { state: "disconnected"; sourceIds: [] }
  | { state: "ambiguous"; sourceIds: [] };

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

function findAtMostTwoSimplePaths(
  adjacency: Map<string, string[]>,
  startSourceId: string,
  endSourceId: string,
) {
  const paths: string[][] = [];
  const queue: string[][] = [[startSourceId]];

  while (queue.length > 0 && paths.length < 2) {
    const path = queue.shift();
    if (!path) break;
    const current = path[path.length - 1];

    if (current === endSourceId) {
      paths.push(path);
      continue;
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (path.includes(neighbor)) continue;
      queue.push([...path, neighbor]);
    }
  }

  return paths;
}

/**
 * Resolve the detailed Street range between two clicked OSM source segments.
 *
 * Street names are deliberately ignored. If the road graph offers more than one
 * simple route between the anchors, the result is ambiguous and the UI must ask
 * for another anchor/waypoint instead of guessing a route through a junction/grid.
 */
export function selectSmartRoadRange(
  roads: SmartRoadCandidate[],
  startSourceId: string,
  endSourceId: string,
): SmartRoadRangeSelection {
  const sourceIds = new Set(roads.map((road) => road.sourceId));
  if (!sourceIds.has(startSourceId) || !sourceIds.has(endSourceId)) {
    return { state: "disconnected", sourceIds: [] };
  }
  if (startSourceId === endSourceId) {
    return { state: "selected", sourceIds: [startSourceId] };
  }

  const paths = findAtMostTwoSimplePaths(adjacencyFor(roads), startSourceId, endSourceId);
  if (paths.length === 0) return { state: "disconnected", sourceIds: [] };
  if (paths.length > 1) return { state: "ambiguous", sourceIds: [] };
  return { state: "selected", sourceIds: paths[0] };
}

export function smartRoadSelectionLabel(
  roads: SmartRoadCandidate[],
  sourceIds: string[],
) {
  if (sourceIds.length === 0) return null;
  const selected = roads.filter((candidate) => sourceIds.includes(candidate.sourceId));
  if (selected.length === 1) {
    return selected[0].name?.trim() || selected[0].ref || selected[0].sourceId;
  }
  return `${selected.length} Straßenabschnitte`;
}
