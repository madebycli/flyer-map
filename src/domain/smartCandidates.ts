import type { Area } from "./campaign.ts";
import type {
  OfflineMapBuildingFeature,
  OfflineMapPackage,
  OfflineMapRoadFeature,
} from "./offlineMap.ts";
import {
  buildingCandidatesForArea,
  roadCandidatesForArea,
} from "./smartGeometry.ts";

export type SmartRoadCandidate = {
  sourceId: string;
  osmId: number;
  name: string | null;
  ref: string | null;
  highway: string;
  geometry: OfflineMapRoadFeature["geometry"];
};

export type SmartBuildingCandidate = {
  sourceId: string;
  osmId: number;
  buildingType: string;
  houseNumber: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  geometry: OfflineMapBuildingFeature["geometry"];
};

export type SmartCandidateSummary = {
  roadCount: number;
  namedRoadCount: number;
  buildingCount: number;
  addressedBuildingCount: number;
};

function tag(tags: Record<string, string>, key: string) {
  const value = tags[key]?.trim();
  return value ? value : null;
}

export function toSmartRoadCandidate(feature: OfflineMapRoadFeature): SmartRoadCandidate {
  return {
    sourceId: feature.id,
    osmId: feature.properties.osmId,
    name: tag(feature.properties.tags, "name"),
    ref: tag(feature.properties.tags, "ref"),
    highway: feature.properties.tags.highway,
    geometry: feature.geometry,
  };
}

export function toSmartBuildingCandidate(
  feature: OfflineMapBuildingFeature,
): SmartBuildingCandidate {
  return {
    sourceId: feature.id,
    osmId: feature.properties.osmId,
    buildingType: feature.properties.tags.building,
    houseNumber: tag(feature.properties.tags, "addr:housenumber"),
    street: tag(feature.properties.tags, "addr:street"),
    postcode: tag(feature.properties.tags, "addr:postcode"),
    city: tag(feature.properties.tags, "addr:city"),
    geometry: feature.geometry,
  };
}

export function smartCandidatesForArea(area: Area, pkg: OfflineMapPackage) {
  const roads = roadCandidatesForArea(area, pkg).map(toSmartRoadCandidate);
  const buildings = buildingCandidatesForArea(area, pkg).map(toSmartBuildingCandidate);
  const summary: SmartCandidateSummary = {
    roadCount: roads.length,
    namedRoadCount: roads.filter((candidate) => candidate.name !== null).length,
    buildingCount: buildings.length,
    addressedBuildingCount: buildings.filter(
      (candidate) => candidate.houseNumber !== null || candidate.street !== null,
    ).length,
  };
  return { roads, buildings, summary };
}
