import type { HouseTask, PolygonGeometry, TaskStatus } from "../domain/campaign.ts";

export type RenderHouse = HouseTask & { color: string; completedColor: string };

export type HouseFeatureProperties = {
  houseTaskId: string;
  status: TaskStatus;
  color: string;
  completedColor: string;
};

export type HouseFeature = {
  type: "Feature";
  id: string;
  properties: HouseFeatureProperties;
  geometry: PolygonGeometry;
};

export type HouseFeatureCollection = {
  type: "FeatureCollection";
  features: HouseFeature[];
};

export const HOUSE_SOURCE_ID = "vf-houses";
export const HOUSE_FILL_LAYER_ID = "vf-houses-fill";
export const HOUSE_OUTLINE_LAYER_ID = "vf-houses-outline";
export const HOUSE_LATER_LAYER_ID = "vf-houses-later";
export const HOUSE_NOT_DELIVERABLE_LAYER_ID = "vf-houses-not-deliverable";
export const HOUSE_SESSION_HIGHLIGHT_LAYER_ID = "vf-houses-session-highlight";
export const HOUSE_SELECTED_LAYER_ID = "vf-houses-selected";

export const HOUSE_LAYER_IDS = [
  HOUSE_FILL_LAYER_ID,
  HOUSE_OUTLINE_LAYER_ID,
  HOUSE_LATER_LAYER_ID,
  HOUSE_NOT_DELIVERABLE_LAYER_ID,
  HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
  HOUSE_SELECTED_LAYER_ID,
] as const;

export const HOUSE_MIN_ZOOM = 15;

export function housesToGeoJson(houses: readonly RenderHouse[]): HouseFeatureCollection {
  return {
    type: "FeatureCollection",
    features: houses.map((house) => ({
      type: "Feature",
      id: house.id,
      properties: {
        houseTaskId: house.id,
        status: house.status,
        color: house.color,
        completedColor: house.completedColor,
      },
      geometry: house.geometry,
    })),
  };
}
