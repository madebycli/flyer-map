import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { applyCampaignMutation, type CampaignMutation } from "../src/domain/mutations.ts";

const originalTimestamp = "2026-08-26T19:05:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 3,
    campaign: {
      id: "campaign_parent-cascade",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt: originalTimestamp,
      updatedAt: originalTimestamp,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_parent-cascade",
        name: "A",
        color: "#2563eb",
        createdAt: originalTimestamp,
        updatedAt: originalTimestamp,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_parent-cascade",
        teamId: "team_a",
        name: "A",
        geometry: {
          type: "Polygon",
          coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
        },
        createdAt: originalTimestamp,
        updatedAt: originalTimestamp,
      },
    ],
    tasks: [
      {
        id: "task_parent",
        campaignId: "campaign_parent-cascade",
        areaId: "area_a",
        taskType: "street",
        label: "Straße",
        geometry: { type: "LineString", coordinates: [[10, 50], [10.05, 50]] },
        status: "open",
        completedAt: null,
        createdAt: originalTimestamp,
        updatedAt: originalTimestamp,
      },
    ],
    houseTasks: [
      {
        id: "task_house",
        campaignId: "campaign_parent-cascade",
        areaId: "area_a",
        taskType: "house",
        label: "Haus 1",
        geometry: {
          type: "Polygon",
          coordinates: [[[10.01, 50.01], [10.02, 50.01], [10.02, 50.02], [10.01, 50.01]]],
        },
        parentStreetTaskId: "task_parent",
        status: "open",
        completedAt: null,
        createdAt: originalTimestamp,
        updatedAt: originalTimestamp,
      },
    ],
  };
}

test("deleting a parent Street mirrors D1 ON DELETE SET NULL without inventing a House updatedAt change", () => {
  const current = snapshot();
  const mutation: CampaignMutation = {
    id: "mutation_delete-parent-cascade",
    campaignId: current.campaign.id,
    type: "task.delete",
    payload: { taskId: "task_parent", expectedUpdatedAt: originalTimestamp },
    baseRevision: current.revision,
    createdAt: "2026-08-26T20:10:00.000Z",
  };

  const next = applyCampaignMutation(current, mutation);
  assert.equal(next.houseTasks?.[0].parentStreetTaskId, null);
  assert.equal(next.houseTasks?.[0].updatedAt, originalTimestamp);
});
