import type {
  LineStringGeometry,
  PolygonGeometry,
} from "../../src/domain/campaign.ts";
import { validateLineStringVertices } from "../../src/domain/geometry.ts";
import { clipLineGeometryToPolygonDetailed } from "./clipRoadsToArea.ts";
import { streetRoadEligibility, STREET_ENGINE_ALGORITHM_VERSION } from "./roadEligibility.ts";
import {
  canonicalStreetGeometryKey,
  preparedStreetFragmentKey,
  preparedStreetSourceKey,
} from "./roadIdentity.ts";
import type {
  StreetInputGeometry,
  StreetPreparationCandidate,
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

function canonicalTagsJson(tags: Record<string, string>) {
  return JSON.stringify(Object.fromEntries(Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))));
}

function sortedRoads(input: StreetPreparationInput["roads"]) {
  return [...input].sort((first, second) =>
    first.properties.osmId - second.properties.osmId
    || canonicalStreetGeometryKey(first.geometry).localeCompare(canonicalStreetGeometryKey(second.geometry))
    || canonicalTagsJson(first.properties.tags).localeCompare(canonicalTagsJson(second.properties.tags))
  );
}

function preparedCandidate(input: {
  osmId: number;
  sourceKey: string;
  fragmentKey: string;
  tags: Record<string, string>;
  geometry: LineStringGeometry;
}): StreetPreparationCandidate {
  return {
    sourceOsmWayId: input.osmId,
    sourceKey: input.sourceKey,
    fragmentKey: input.fragmentKey,
    label: roadLabel(input.tags),
    geometry: input.geometry,
  };
}

export async function prepareStreetsForArea(
  input: StreetPreparationInput,
): Promise<StreetPreparationResult> {
  const startedAt = Date.now();
  const candidates: StreetPreparationCandidate[] = [];
  const seenInputRoads = new Set<string>();
  const seenFragments = new Set<string>();
  let eligibleRoadCount = 0;
  let rejectedRoadCount = 0;
  let invalidRoadCount = 0;
  let topologyFailureCount = 0;
  let duplicateFragmentCount = 0;

  for (const road of sortedRoads(input.roads)) {
    if (!Number.isSafeInteger(road.properties.osmId) || road.properties.osmId <= 0) {
      invalidRoadCount += 1;
      continue;
    }
    const sourceKey = preparedStreetSourceKey({
      sourceOsmWayId: road.properties.osmId,
      geometry: road.geometry,
    });
    if (seenInputRoads.has(sourceKey)) {
      duplicateFragmentCount += 1;
      continue;
    }
    seenInputRoads.add(sourceKey);

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

    const clipped = clipLineGeometryToPolygonDetailed(road.geometry, input.area);
    if (clipped.failure === "topology") {
      topologyFailureCount += 1;
    } else if (clipped.failure !== null) {
      invalidRoadCount += 1;
    }

    for (const geometry of clipped.fragments) {
      if (!validateLineStringVertices(geometry.coordinates).valid) {
        invalidRoadCount += 1;
        continue;
      }
      const fragmentKey = preparedStreetFragmentKey({
        sourceOsmWayId: road.properties.osmId,
        geometry,
      });
      if (seenFragments.has(fragmentKey)) {
        duplicateFragmentCount += 1;
        continue;
      }
      if (candidates.length >= input.maxRoadFragments) {
        throw new StreetPreparationLimitError();
      }
      seenFragments.add(fragmentKey);
      candidates.push(preparedCandidate({
        osmId: road.properties.osmId,
        sourceKey,
        fragmentKey,
        tags: road.properties.tags,
        geometry,
      }));
    }
  }

  return {
    candidates,
    diagnostics: {
      algorithmVersion: STREET_ENGINE_ALGORITHM_VERSION,
      inputRoadCount: input.roads.length,
      eligibleRoadCount,
      rejectedRoadCount,
      invalidRoadCount,
      topologyFailureCount,
      fragmentCount: candidates.length,
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
        roadRequestCount: 0,
        buildingRequestCount: 0,
        roadUpstreamBytes: 0,
        buildingUpstreamBytes: 0,
        roadParsedElementCount: 0,
        buildingParsedElementCount: 0,
        roadNormalizationRejectedCount: 0,
        buildingNormalizationRejectedCount: 0,
      },
    },
  };
}

export type { PolygonGeometry };
