import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot, DistributionTask } from "../src/domain/campaign.ts";
import {
  calculateAreaProgress,
  calculateCampaignProgress,
  calculateTeamProgress,
  summarizeStreetTasks,
} from "../src/domain/progressStats.ts";

function task(
  id: string,
  areaId: string,
  status: DistributionTask["status"],
): DistributionTask {
  return {
    id,
    campaignId: "campaign_stats",
    areaId,
    taskType: "street",
    label: id,
    geometry: {
      type: "LineString",
      coordinates: [
        [13.4, 52.5],
        [13.41, 52.51],
      ],
    },
    status,
    completedAt: status === "completed" ? "2026-08-25T10:00:00.000Z" : null,
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
}

function snapshotFixture(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 7,
    campaign: {
      id: "campaign_stats",
      name: "Stats",
      status: "active",
      defaultMapView: null,
      createdAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_stats",
        name: "A",
        color: "#2563eb",
        createdAt: "2026-08-25T08:00:00.000Z",
        updatedAt: "2026-08-25T08:00:00.000Z",
      },
      {
        id: "team_b",
        campaignId: "campaign_stats",
        name: "B",
        color: "#ea580c",
        createdAt: "2026-08-25T08:00:00.000Z",
        updatedAt: "2026-08-25T08:00:00.000Z",
      },
    ],
    areas: [
      {
        id: "area_a1",
        campaignId: "campaign_stats",
        teamId: "team_a",
        name: "A1",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [13.3, 52.4],
              [13.5, 52.4],
              [13.5, 52.6],
              [13.3, 52.4],
            ],
          ],
        },
        createdAt: "2026-08-25T08:00:00.000Z",
        updatedAt: "2026-08-25T08:00:00.000Z",
      },
      {
        id: "area_b1",
        campaignId: "campaign_stats",
        teamId: "team_b",
        name: "B1",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [13.6, 52.4],
              [13.8, 52.4],
              [13.8, 52.6],
              [13.6, 52.4],
            ],
          ],
        },
        createdAt: "2026-08-25T08:00:00.000Z",
        updatedAt: "2026-08-25T08:00:00.000Z",
      },
    ],
    tasks: [
      task("task_a_done", "area_a1", "completed"),
      task("task_a_open", "area_a1", "open"),
      task("task_a_later", "area_a1", "later"),
      task("task_b_blocked", "area_b1", "not-deliverable"),
    ],
  };
}

test("street progress uses an explicit street-task denominator", () => {
  const summary = summarizeStreetTasks([
    task("done", "area", "completed"),
    task("open", "area", "open"),
    task("later", "area", "later"),
    task("blocked", "area", "not-deliverable"),
  ]);

  assert.deepEqual(summary, {
    denominator: "street-tasks",
    total: 4,
    completed: 1,
    open: 1,
    later: 1,
    notDeliverable: 1,
    remaining: 3,
    percentCompleted: 25,
  });
});

test("empty progress is unknown instead of pretending to be zero or complete", () => {
  const summary = summarizeStreetTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.percentCompleted, null);
  assert.equal(summary.remaining, 0);
});

test("campaign progress reconciles exactly with all current street tasks", () => {
  const summary = calculateCampaignProgress(snapshotFixture());
  assert.equal(summary.total, 4);
  assert.equal(summary.completed, 1);
  assert.equal(summary.percentCompleted, 25);
});

test("team progress includes only tasks owned through that team's areas", () => {
  const summary = calculateTeamProgress(snapshotFixture(), "team_a");
  assert.equal(summary.areaCount, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.percentCompleted, 100 / 3);
});

test("area progress keeps team ownership and returns null for unknown areas", () => {
  const snapshot = snapshotFixture();
  const area = calculateAreaProgress(snapshot, "area_b1");
  assert.equal(area?.teamId, "team_b");
  assert.equal(area?.total, 1);
  assert.equal(area?.notDeliverable, 1);
  assert.equal(area?.percentCompleted, 0);
  assert.equal(calculateAreaProgress(snapshot, "missing"), null);
});
