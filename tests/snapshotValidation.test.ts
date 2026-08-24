import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { validateCampaignSnapshot } from "../worker/snapshotValidation.ts";

function validSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 7,
    campaign: {
      id: "campaign_test-1",
      name: "Testaktion",
      status: "active",
      defaultMapView: {
        center: [9.48, 51.31],
        zoom: 12,
        bearing: 80,
      },
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:01:00.000Z",
    },
    teams: [
      {
        id: "team_blue-1",
        campaignId: "campaign_test-1",
        name: "Team Blau",
        color: "#2563eb",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    ],
    areas: [
      {
        id: "area_one-1",
        campaignId: "campaign_test-1",
        teamId: "team_blue-1",
        name: "Gebiet 1",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [8.60, 49.40],
              [8.61, 49.40],
              [8.61, 49.41],
              [8.60, 49.41],
              [8.60, 49.40],
            ],
          ],
        },
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "task_street-1",
        campaignId: "campaign_test-1",
        areaId: "area_one-1",
        taskType: "street",
        label: "Straße 1",
        geometry: {
          type: "LineString",
          coordinates: [
            [8.601, 49.401],
            [8.609, 49.409],
          ],
        },
        status: "completed",
        completedAt: "2026-08-24T00:02:00.000Z",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:02:00.000Z",
      },
    ],
  };
}

test("accepts a valid schema-v3 campaign/team/area/street snapshot", () => {
  const result = validateCampaignSnapshot(validSnapshot(), "campaign_test-1");
  assert.equal(result.valid, true);
});

test("accepts a campaign without a shared default map view", () => {
  const snapshot = validSnapshot();
  snapshot.campaign.defaultMapView = null;
  assert.equal(validateCampaignSnapshot(snapshot, snapshot.campaign.id).valid, true);
});

test("rejects an invalid shared map view", () => {
  const snapshot = validSnapshot();
  snapshot.campaign.defaultMapView = { center: [9.4, 95], zoom: 12, bearing: 0 };
  assert.equal(validateCampaignSnapshot(snapshot, snapshot.campaign.id).valid, false);
});

test("rejects a polygon that self-intersects", () => {
  const snapshot = validSnapshot();
  snapshot.areas[0].geometry.coordinates = [
    [
      [8.60, 49.40],
      [8.61, 49.41],
      [8.60, 49.41],
      [8.61, 49.40],
      [8.60, 49.40],
    ],
  ];

  const result = validateCampaignSnapshot(snapshot, "campaign_test-1");
  assert.equal(result.valid, false);
});

test("rejects cross-campaign or missing team ownership", () => {
  const snapshot = validSnapshot();
  snapshot.areas[0].teamId = "team_foreign-1";

  const result = validateCampaignSnapshot(snapshot, "campaign_test-1");
  assert.deepEqual(result, {
    valid: false,
    message: "Ein Gebiet verweist auf ein fremdes oder fehlendes Team.",
  });
});

test("requires completedAt exactly for completed street tasks", () => {
  const snapshot = validSnapshot();
  snapshot.tasks[0].completedAt = null;

  const result = validateCampaignSnapshot(snapshot, "campaign_test-1");
  assert.equal(result.valid, false);
});

test("rejects snapshots whose campaign does not match the route", () => {
  const result = validateCampaignSnapshot(validSnapshot(), "campaign_other-1");
  assert.deepEqual(result, {
    valid: false,
    message: "Campaign-Daten sind ungültig oder gehören zu einer anderen Campaign.",
  });
});
