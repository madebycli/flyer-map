import type {
  DistributionTask,
  LineStringGeometry,
  PolygonGeometry,
} from "../../src/domain/campaign.ts";
import { validateLineStringVertices } from "../../src/domain/geometry.ts";
import { clipLineGeometryToPolygon } from "./clipRoadsToArea.ts";
import { streetRoadEligibility, STREET_ENGINE_ALGORITHM_VERSION } from "./roadEligibility.ts";
import {
  canonicalStreetGeometryKey,
  canonicalStreetLineKey,
  stableStreetTaskId,
} from "./roadIdentity.ts";
import type {
  StreetInputGeometry,
  StreetPreparationInput,
  StreetPreparationResult,
} from "./types.ts";

export { STREET_ENGINE_ALGORITHM_VERSION };

export class StreetPreparationLimitError extends Error {
  readonly code = "too_many_fragments" as const;

  constructor() {
    super("Die vorbereitete Street-Menge überschreitet die Fragment-Grenze.");
    this.name = "StreetPreparationLimitError";
  }
}

function roadLabel(tags: Record<string, string>) {
  return tags.name?.trim() || tags.ref?.trim() || "Straße";
}

function taskSource(osmId: number) {
  return {
    dataset: "OpenStreetMap" as const,
    objectType: "way" as const,
    objectIds: [osmId],
  };
}

function validCoordinate(coordinate: [number, number]) {
  return Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

function validInputGeometry(geometry: StreetInputGeometry): boolean {
  if (geometry.type === "LineString") {
    return geometry.coordinates.length >= 2
      && geometry.coordinates.every(validCoordinate)
      && geometry.coordinates.some((coordinate, index, coordinates) =>
        index > 0 && (coordinate[0] !== coordinates[index - 1][0] || coordinate[1] !== coordinates[index - 1][1])
      );
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.length > 0
      && geometry.coordinates.every((coordinates) =>
        validInputGeometry({ type: "LineString", coordinates })
      );
  }
  return geometry.geometries.length > 0 && geometry.geometries.every(validInputGeometry);
}

function sortedRoads(input: StreetPreparationInput["roads"]) {
  return [...input].sort((first, second) =>
    first.properties.osmId - second.properties.osmId
    || canonicalStreetGeometryKey(first.geometry).localeCompare(canonicalStreetGeometryKey(second.geometry))
    || JSON.stringify(first.properties.tags).localeCompare(JSON.stringify(second.properties.tags))
  );
}

function preparedTask(input: {
  campaignId: string;
  areaId: string;
  generation: string;
  osmId: number;
  tags: Record<string, string>;
  geometry: LineStringGeometry;
  timestamp: string;
}) {
  return {
    id: stableStreetTaskId({
      campaignId: input.campaignId,
      areaId: input.areaId,
      osmId: input.osmId,
      geometry: input.geometry,
    }),
    campaignId: input.campaignId,
    areaId: input.areaId,
    taskType: "street" as const,
    label: roadLabel(input.tags),
    geometry: input.geometry,
    source: taskSource(input.osmId),
    areaPreparationGeneration: input.generation,
    status: "open" as const,
    completedAt: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  } satisfies DistributionTask;
}

export function prepareStreetsForArea(input: StreetPreparationInput): StreetPreparationResult {
  const startedAt = Date.now();
  const tasks: DistributionTask[] = [];
  const seenInputRoads = new Set<string>();
  const seenFragments = new Set<string>();
  let eligibleRoadCount = 0;
  let rejectedRoadCount = 0;
  let invalidRoadCount = 0;
  let duplicateFragmentCount = 0;

  for (const road of sortedRoads(input.roads)) {
    if (!Number.isSafeInteger(road.properties.osmId) || road.properties.osmId <= 0) {
      invalidRoadCount += 1;
      continue;
    }
    const inputKey = String(road.properties.osmId) + "|" + canonicalStreetGeometryKey(road.geometry);
    if (seenInputRoads.has(inputKey)) {
      duplicateFragmentCount += 1;
      continue;
    }
    seenInputRoads.add(inputKey);

    if (!validInputGeometry(road.geometry)) {
      invalidRoadCount += 1;
      continue;
    }
    const eligibility = streetRoadEligibility(road.properties.tags);
    if (!eligibility.eligible) {
      rejectedRoadCount += 1;
      continue;
    }
    eligibleRoadCount += 1;

    const fragments = clipLineGeometryToPolygon(road.geometry, input.area);
    for (const geometry of fragments) {
      if (!validateLineStringVertices(geometry.coordinates).valid) {
        invalidRoadCount += 1;
        continue;
      }
      const fragmentKey = String(road.properties.osmId) + "|" + canonicalStreetLineKey(geometry);
      if (seenFragments.has(fragmentKey)) {
        duplicateFragmentCount += 1;
        continue;
      }
      if (tasks.length >= input.maxRoadFragments) {
        throw new StreetPreparationLimitError();
      }
      seenFragments.add(fragmentKey);
      tasks.push(preparedTask({
        campaignId: input.campaignId,
        areaId: input.areaId,
        generation: input.generation,
        osmId: road.properties.osmId,
        tags: road.properties.tags,
        geometry,
        timestamp: input.timestamp,
      }));
    }
  }

  tasks.sort((first, second) => first.id.localeCompare(second.id));
  return {
    tasks,
    diagnostics: {
      algorithmVersion: STREET_ENGINE_ALGORITHM_VERSION,
      inputRoadCount: input.roads.length,
      eligibleRoadCount,
      rejectedRoadCount,
      invalidRoadCount,
      fragmentCount: tasks.length,
      duplicateFragmentCount,
      durationMs: Math.max(0, Date.now() - startedAt),
      source: {
        requestCount: 0,
        tileCount: 0,
        maxConcurrentRequests: 0,
        upstreamBytes: 0,
        parsedElementCount: 0,
        normalizedRoadCount: input.roads.length,
        normalizedBuildingCount: 0,
        packageBytes: 0,
      },
    },
  };
}

export type { PolygonGeometry };
