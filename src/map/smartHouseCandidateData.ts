import type { SmartBuildingCandidate } from "../domain/smartCandidates.ts";

export type SmartHouseCandidateFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      sourceId: string;
      style: "candidate";
    };
    geometry: SmartBuildingCandidate["geometry"];
  }>;
};

export function smartHouseBuildingsToGeoJson(
  buildings: readonly SmartBuildingCandidate[],
): SmartHouseCandidateFeatureCollection {
  return {
    type: "FeatureCollection",
    features: buildings.map((building) => ({
      type: "Feature",
      id: building.sourceId,
      properties: {
        sourceId: building.sourceId,
        style: "candidate",
      },
      geometry: building.geometry,
    })),
  };
}
