import type { CollectionArea, CollectionAreaProgress, CollectionRoadSection } from "./collection.ts";
import type { PickupTask } from "./pickup.ts";

type CollectionProgressSource = {
  areas: CollectionArea[];
  roadSections?: CollectionRoadSection[];
  pickups?: PickupTask[];
};

/** Derives pickup progress from the same local snapshot used by the UI. */
export function deriveCollectionProgress({ areas, roadSections = [], pickups = [] }: CollectionProgressSource): CollectionAreaProgress[] {
  return areas.map((area) => {
    const areaSections = roadSections.filter((section) => section.areaId === area.id);
    const areaPickups = pickups.filter((pickup) => pickup.areaId === area.id && pickup.archivedAt === null);
    return {
      areaId: area.id,
      roadSectionsTotal: areaSections.length,
      roadSectionsDriven: areaSections.filter((section) => section.status === "driven").length,
      roadSectionsOpen: areaSections.filter((section) => section.status === "open").length,
      roadSectionsLater: areaSections.filter((section) => section.status === "later").length,
      roadSectionsUnavailable: areaSections.filter((section) => section.status === "unavailable").length,
      pickupsTotal: areaPickups.length,
      pickupsCollected: areaPickups.filter((pickup) => pickup.status === "collected").length,
      updatedAt: area.updatedAt,
    };
  });
}
