import type { HouseTask } from "./campaign.ts";
import { validatePolygonVertices } from "./geometry.ts";
import type { SmartBuildingCandidate } from "./smartCandidates.ts";
import { smartBuildingLabel } from "./smartBuildingSelection.ts";

export class SmartHouseTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartHouseTaskError";
  }
}

function reviewedBuildingGeometry(candidate: SmartBuildingCandidate) {
  const ring = candidate.geometry.coordinates[0] ?? [];
  if (ring.length < 4) throw new SmartHouseTaskError("building_geometry_invalid");

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new SmartHouseTaskError("building_geometry_not_closed");
  }

  const validation = validatePolygonVertices(ring.slice(0, -1));
  if (!validation.valid) throw new SmartHouseTaskError("building_geometry_invalid");

  return {
    type: "Polygon" as const,
    coordinates: [ring.map(([lng, lat]) => [lng, lat] as [number, number])],
  };
}

export function createSmartHouseTaskSnapshot(input: {
  campaignId: string;
  areaId: string;
  building: SmartBuildingCandidate;
  parentStreetTaskId?: string | null;
  taskId?: string;
  timestamp?: string;
}): HouseTask {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    id: input.taskId ?? `task_${crypto.randomUUID()}`,
    campaignId: input.campaignId,
    areaId: input.areaId,
    taskType: "house",
    label: smartBuildingLabel(input.building),
    geometry: reviewedBuildingGeometry(input.building),
    source: {
      dataset: "OpenStreetMap",
      objectType: "way",
      objectIds: [input.building.osmId],
    },
    areaPreparationGeneration: null,
    parentStreetTaskId: input.parentStreetTaskId ?? null,
    status: "open",
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
