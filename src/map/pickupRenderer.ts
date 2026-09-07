import type { LngLat } from "../domain/campaign";
import { isPickupPosition, type PickupStatus, type PickupTask } from "../domain/pickup.ts";

export const COLLECTION_PICKUP_SOURCE_ID = "vf-collection-pickups";
export const COLLECTION_PICKUP_MARKER_LAYER_ID = "vf-collection-pickups-marker";
export const COLLECTION_PICKUP_SELECTED_LAYER_ID = "vf-collection-pickups-selected";
export const COLLECTION_PICKUP_LAYER_IDS = [
  COLLECTION_PICKUP_SELECTED_LAYER_ID,
  COLLECTION_PICKUP_MARKER_LAYER_ID,
] as const;

export type PickupFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      pickupId: string;
      status: PickupStatus;
    };
    geometry: {
      type: "Point";
      coordinates: LngLat;
    };
  }>;
};

export function pickupsToGeoJson(pickups: readonly PickupTask[]): PickupFeatureCollection {
  return {
    type: "FeatureCollection",
    features: pickups
      .filter((pickup) => pickup.archivedAt === null && isPickupPosition(pickup.position))
      .map((pickup) => ({
        type: "Feature",
        id: pickup.id,
        properties: {
          pickupId: pickup.id,
          status: pickup.status,
        },
        geometry: {
          type: "Point",
          coordinates: [pickup.position[0], pickup.position[1]],
        },
      })),
  };
}
