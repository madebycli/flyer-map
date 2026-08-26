import type { SmartBuildingCandidate } from "./smartCandidates.ts";

function normalizedStreetName(value: string | null) {
  return value?.trim().toLocaleLowerCase("de-DE") || null;
}

export function toggleSmartBuildingSourceId(
  selectedSourceIds: string[],
  sourceId: string,
  buildings: SmartBuildingCandidate[],
) {
  if (!buildings.some((candidate) => candidate.sourceId === sourceId)) {
    return selectedSourceIds;
  }
  const selected = new Set(selectedSourceIds);
  if (selected.has(sourceId)) selected.delete(sourceId);
  else selected.add(sourceId);
  return buildings
    .filter((candidate) => selected.has(candidate.sourceId))
    .map((candidate) => candidate.sourceId);
}

export function selectSmartBuildingsForStreet(
  buildings: SmartBuildingCandidate[],
  street: string,
) {
  const normalized = normalizedStreetName(street);
  if (!normalized) return [];
  return buildings
    .filter((candidate) => normalizedStreetName(candidate.street) === normalized)
    .map((candidate) => candidate.sourceId);
}

export function smartBuildingLabel(candidate: SmartBuildingCandidate) {
  const address = [candidate.street?.trim(), candidate.houseNumber?.trim()]
    .filter(Boolean)
    .join(" ");
  if (address) return address;
  return `Gebäude ${candidate.sourceId}`;
}

export function selectedSmartBuildingLabels(
  buildings: SmartBuildingCandidate[],
  selectedSourceIds: string[],
) {
  const selected = new Set(selectedSourceIds);
  return buildings
    .filter((candidate) => selected.has(candidate.sourceId))
    .map(smartBuildingLabel);
}
