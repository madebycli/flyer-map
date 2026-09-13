import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionSnapshotOrEmpty,
  type CollectionArea,
  type CollectionRoadSection,
} from "../src/domain/collection.ts";
import type { PickupTask } from "../src/domain/pickup.ts";

const stamp = "2026-09-13T10:00:00.000Z";

const area: CollectionArea = {
  id: "collection_area_progress",
  campaignId: "campaign_progress",
  mainAreaId: "collection_main_progress",
  name: "Nord",
  geometry: { type: "Polygon", coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]] },
  color: "#2563eb",
  status: "in-progress",
  runId: null,
  claimedByCollectorId: null,
  claimedByLabel: null,
  completedAt: null,
  pickupState: "in-progress",
  roomId: "collection_room_progress",
  createdAt: stamp,
  updatedAt: stamp,
};

function section(id: string, status: CollectionRoadSection["status"]): CollectionRoadSection {
  return {
    id,
    campaignId: area.campaignId,
    areaId: area.id,
    label: id,
    geometry: { type: "LineString", coordinates: [[13, 51], [13.001, 51]] },
    status,
    coverage: [],
    sourceTaskId: null,
    sourceGeneration: null,
    source: null,
    smartMarking: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function pickup(id: string, status: PickupTask["status"], archivedAt: string | null = null): PickupTask {
  return {
    id,
    campaignId: area.campaignId,
    areaId: area.id,
    title: id,
    address: "Nordstraße 1",
    description: "",
    position: [13, 51],
    status,
    archivedAt,
    assignedRunIds: [],
    assignedCollectorIds: [],
    source: null,
    createdBy: { kind: "campaign-grant", ref: "grant_progress" },
    updatedBy: { kind: "campaign-grant", ref: "grant_progress" },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

test("collection snapshot derives independent road and active pickup progress", () => {
  const snapshot = collectionSnapshotOrEmpty({
    mainArea: null,
    areas: [area],
    runs: [],
    roadSections: [section("driven", "driven"), section("later", "later"), section("open", "open")],
    pickups: [pickup("collected", "collected"), pickup("open", "open"), pickup("archived", "collected", "2026-09-13T10:05:00.000Z")],
    progress: [{
      areaId: area.id,
      roadSectionsTotal: 0,
      roadSectionsDriven: 0,
      roadSectionsOpen: 0,
      roadSectionsLater: 0,
      roadSectionsUnavailable: 0,
      pickupsTotal: 0,
      pickupsCollected: 0,
      updatedAt: stamp,
    }],
  });

  assert.deepEqual(snapshot.progress, [{
    areaId: area.id,
    roadSectionsTotal: 3,
    roadSectionsDriven: 1,
    roadSectionsOpen: 1,
    roadSectionsLater: 1,
    roadSectionsUnavailable: 0,
    pickupsTotal: 2,
    pickupsCollected: 1,
    updatedAt: stamp,
  }]);
});

test("legacy collection snapshots retain stored progress until pickup fields are present", () => {
  const storedProgress = {
    areaId: area.id,
    roadSectionsTotal: 4,
    roadSectionsDriven: 2,
    roadSectionsOpen: 1,
    roadSectionsLater: 1,
    roadSectionsUnavailable: 0,
    pickupsTotal: 0,
    pickupsCollected: 0,
    updatedAt: stamp,
  };
  const snapshot = collectionSnapshotOrEmpty({ mainArea: null, areas: [area], runs: [], progress: [storedProgress] });
  assert.deepEqual(snapshot.progress, [storedProgress]);
});
