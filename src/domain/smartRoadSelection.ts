import type { SmartRoadCandidate } from "./smartCandidates.ts";

export type SmartRoadSelectionMode = "source-segment" | "connected-same-name";

type Coordinate = [number, number];

function normalizedRoadName(value: string | null) {
  return value?.trim().toLocaleLowerCase("de-DE") || null;
}

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

export function selectSmartRoadSourceIds(
  roads: SmartRoadCandidate[],
  selectedSourceId: string,
  mode: SmartRoadSelectionMode,
) {
  const selected = roads.find((candidate) => candidate.sourceId === selectedSourceId);
  if (!selected) return [];
  if (mode === "source-segment") return [selected.sourceId];

  const selectedName = normalizedRoadName(selected.name);
  if (!selectedName) return [selected.sourceId];

  const sameName = roads.filter(
    (candidate) => normalizedRoadName(candidate.name) === selectedName,
  );
  const selectedIds = new Set<string>([selected.sourceId]);
  const queue = [selected];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    for (const candidate of sameName) {
      if (selectedIds.has(candidate.sourceId)) continue;
      if (!candidatesTouch(current, candidate)) continue;
      selectedIds.add(candidate.sourceId);
      queue.push(candidate);
    }
  }

  return roads
    .filter((candidate) => selectedIds.has(candidate.sourceId))
    .map((candidate) => candidate.sourceId);
}

export function smartRoadSelectionLabel(
  roads: SmartRoadCandidate[],
  sourceIds: string[],
) {
  if (sourceIds.length === 0) return null;
  const selected = roads.filter((candidate) => sourceIds.includes(candidate.sourceId));
  const named = selected.map((candidate) => candidate.name?.trim()).filter(Boolean) as string[];
  const uniqueNames = [...new Set(named)];
  if (uniqueNames.length === 1) return uniqueNames[0];
  if (selected.length === 1) return selected[0].ref ?? selected[0].sourceId;
  return `${selected.length} Straßenabschnitte`;
}
