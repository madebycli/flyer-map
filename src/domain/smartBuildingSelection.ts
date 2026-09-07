import type { SmartBuildingCandidate } from "./smartCandidates.ts";
import type { HouseTask } from "./campaign.ts";
import { HOUSE_CREATE_BATCH_MAX } from "./mutations.ts";

function normalizedStreetName(value: string | null) {
  return value?.trim().toLocaleLowerCase("de-DE") || null;
}

function hasSameOsmWay(candidate: SmartBuildingCandidate, house: HouseTask) {
  const source = house.source;
  return (
    source?.dataset === "OpenStreetMap" &&
    source.objectType === "way" &&
    source.objectIds.length === 1 &&
    source.objectIds[0] === candidate.osmId
  );
}

export function availableSmartBuildingsForCreation(
  buildings: readonly SmartBuildingCandidate[],
  persistedHouses: readonly HouseTask[],
) {
  const persisted = persistedHouses;
  const seenSourceIds = new Set<string>();
  return buildings.filter((candidate) => {
    if (seenSourceIds.has(candidate.sourceId)) return false;
    seenSourceIds.add(candidate.sourceId);
    return !persisted.some((house) => hasSameOsmWay(candidate, house));
  });
}

export function smartBuildingStreetOptions(
  buildings: readonly SmartBuildingCandidate[],
  limit = 24,
) {
  return [
    ...new Set(
      buildings
        .map((building) => building.street?.trim())
        .filter((street): street is string => Boolean(street)),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, "de-DE"))
    .slice(0, Math.max(0, limit));
}

export function toggleSmartBuildingSourceId(
  selectedSourceIds: string[],
  sourceId: string,
  buildings: readonly SmartBuildingCandidate[],
) {
  if (!buildings.some((candidate) => candidate.sourceId === sourceId)) {
    return selectedSourceIds;
  }
  const selected = new Set(selectedSourceIds);
  if (selected.has(sourceId)) selected.delete(sourceId);
  else if (selected.size < HOUSE_CREATE_BATCH_MAX) selected.add(sourceId);
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
