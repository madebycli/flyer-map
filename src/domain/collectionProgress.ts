import type { CollectionArea, CollectionAreaProgress, CollectionRoadSection } from "./collection.ts";
import type { PickupTask } from "./pickup.ts";

type CollectionProgressSource = {
  areas: CollectionArea[];
  roadSections?: CollectionRoadSection[];
  pickups?: PickupTask[];
};

export type CollectionProgressSummary = {
  roadSectionsTotal: number;
  roadSectionsDriven: number;
  roadSectionsOpen: number;
  roadSectionsLater: number;
  roadSectionsUnavailable: number;
  pickupsTotal: number;
  pickupsCollected: number;
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

export function summarizeCollectionProgress(progress: readonly CollectionAreaProgress[]): CollectionProgressSummary {
  return progress.reduce<CollectionProgressSummary>(
    (summary, area) => ({
      roadSectionsTotal: summary.roadSectionsTotal + area.roadSectionsTotal,
      roadSectionsDriven: summary.roadSectionsDriven + area.roadSectionsDriven,
      roadSectionsOpen: summary.roadSectionsOpen + area.roadSectionsOpen,
      roadSectionsLater: summary.roadSectionsLater + area.roadSectionsLater,
      roadSectionsUnavailable: summary.roadSectionsUnavailable + area.roadSectionsUnavailable,
      pickupsTotal: summary.pickupsTotal + area.pickupsTotal,
      pickupsCollected: summary.pickupsCollected + area.pickupsCollected,
    }),
    {
      roadSectionsTotal: 0,
      roadSectionsDriven: 0,
      roadSectionsOpen: 0,
      roadSectionsLater: 0,
      roadSectionsUnavailable: 0,
      pickupsTotal: 0,
      pickupsCollected: 0,
    },
  );
}
