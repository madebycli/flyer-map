import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { sameSnapshotContent } from "../src/domain/snapshotComparison.ts";

const timestamp = "2026-09-01T20:00:00.000Z";
const campaignId = "campaign_store-comparison";
const areaGeometry = {
  type: "Polygon" as const,
  coordinates: [[[13, 51], [13.001, 51], [13.001, 51.001], [13, 51.001], [13, 51]]],
};

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: {
      id: campaignId,
      name: "Test",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [{
      id: "team_store-comparison",
      campaignId,
      name: "Team",
      color: "#ea580c",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    areas: [{
      id: "area_store-comparison",
      campaignId,
      teamId: "team_store-comparison",
      name: "Gebiet",
      geometry: areaGeometry,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    tasks: [],
  };
}

test("optional post-migration collections do not create a false sync conflict when empty", () => {
  const local = snapshot();
  const server = {
    ...local,
    revision: 5,
    houseTasks: [],
    collection: { mainArea: null, areas: [], runs: [], pickups: [] },
  };

  assert.equal(sameSnapshotContent(local, server), true);
});

test("real post-migration collection or house changes remain a conflict", () => {
  const local = snapshot();
  const server = {
    ...local,
    revision: 5,
    houseTasks: [],
    collection: { mainArea: null, areas: [], runs: [], pickups: [] },
  };

  assert.equal(
    sameSnapshotContent(local, {
      ...server,
      houseTasks: [{
        id: "task_house",
        campaignId,
        areaId: "area_store-comparison",
        taskType: "house",
        label: "Haus",
        geometry: areaGeometry,
        parentStreetTaskId: null,
        areaPreparationGeneration: "123e4567-e89b-42d3-a456-426614174000",
        status: "open",
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
    }),
    false,
  );
  assert.equal(
    sameSnapshotContent(local, {
      ...server,
      collection: {
        ...server.collection,
        mainArea: {
          id: "collection_main",
          campaignId,
          name: "Collection",
          geometry: areaGeometry,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    }),
    false,
  );
});
