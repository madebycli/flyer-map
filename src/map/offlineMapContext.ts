import type {
  OfflineMapBuildingFeature,
  OfflineMapPackage,
  OfflineMapRoadFeature,
} from "../domain/offlineMap.ts";

export const OFFLINE_BUILDING_SOURCE_ID = "vf-offline-buildings";
export const OFFLINE_ROAD_SOURCE_ID = "vf-offline-roads";
export const OFFLINE_BUILDING_LAYER_ID = "vf-offline-buildings-fill";
export const OFFLINE_ROAD_LAYER_ID = "vf-offline-roads-line";

export type OfflineBuildingFeatureCollection = {
  type: "FeatureCollection";
  features: OfflineMapBuildingFeature[];
};

export type OfflineRoadFeatureCollection = {
  type: "FeatureCollection";
  features: OfflineMapRoadFeature[];
};

export function emptyOfflineBuildings(): OfflineBuildingFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function emptyOfflineRoads(): OfflineRoadFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function offlineBuildingData(
  pkg: OfflineMapPackage | null,
): OfflineBuildingFeatureCollection {
  return pkg?.buildings ?? emptyOfflineBuildings();
}

export function offlineRoadData(pkg: OfflineMapPackage | null): OfflineRoadFeatureCollection {
  return pkg?.roads ?? emptyOfflineRoads();
}

export type OfflineMapRendererMode = {
  offlineVisibility: "visible" | "none";
};

export function offlineMapRendererMode(
  online: boolean,
  pkg: OfflineMapPackage | null,
): OfflineMapRendererMode {
  return {
    offlineVisibility: !online && pkg ? "visible" : "none",
  };
}
