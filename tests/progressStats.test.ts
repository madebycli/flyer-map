import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignSnapshot,
  DistributionTask,
  HouseTask,
} from "../src/domain/campaign.ts";
import {
  calculateAreaProgress,
  calculateCampaignProgress,
  calculateTeamHouseProgress,
  calculateTeamProgress,
  summarizeHouseTasks,
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

function house(
  id: string,
  areaId: string,
  status: HouseTask["status"],
): HouseTask {
  return {
    id,
    campaignId: "campaign_stats",
    areaId,
    taskType: "house",
    label: id,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [13.4, 52.5],
          [13.401, 52.5],
          [13.401, 52.501],
          [13.4, 52.5],
        ],
      ],
    },
    parentStreetTaskId: null,
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
    houseTasks: [
      house("house_a_done", "area_a1", "completed"),
      house("house_a_open", "area_a1", "open"),
      house("house_b_later", "area_b1", "later"),
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

test("house progress has its own denominator instead of being mixed into street progress", () => {
  const summary = summarizeHouseTasks([
    house("done", "area", "completed"),
    house("open", "area", "open"),
  ]);

  assert.deepEqual(summary, {
    denominator: "house-tasks",
    total: 2,
    completed: 1,
    open: 1,
    later: 0,
    notDeliverable: 0,
    remaining: 1,
    percentCompleted: 50,
  });
});

test("empty progress is unknown instead of pretending to be zero or complete", () => {
  const streets = summarizeStreetTasks([]);
  const houses = summarizeHouseTasks([]);
  assert.equal(streets.total, 0);
  assert.equal(streets.percentCompleted, null);
  assert.equal(streets.remaining, 0);
  assert.equal(houses.total, 0);
  assert.equal(houses.percentCompleted, null);
  assert.equal(houses.remaining, 0);
});

test("campaign progress reconciles exactly with all current street tasks", () => {
  const summary = calculateCampaignProgress(snapshotFixture());
  assert.equal(summary.total, 4);
  assert.equal(summary.completed, 1);
  assert.equal(summary.percentCompleted, 25);
});

test("team street progress includes only tasks owned through that team's areas", () => {
  const summary = calculateTeamProgress(snapshotFixture(), "team_a");
  assert.equal(summary.areaCount, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.percentCompleted, (1 / 3) * 100);
});

test("team house progress uses the same canonical Area to Team scope but a separate denominator", () => {
  const teamA = calculateTeamHouseProgress(snapshotFixture(), "team_a");
  const teamB = calculateTeamHouseProgress(snapshotFixture(), "team_b");

  assert.equal(teamA.denominator, "house-tasks");
  assert.equal(teamA.areaCount, 1);
  assert.equal(teamA.total, 2);
  assert.equal(teamA.completed, 1);
  assert.equal(teamA.percentCompleted, 50);

  assert.equal(teamB.total, 1);
  assert.equal(teamB.completed, 0);
  assert.equal(teamB.later, 1);
  assert.equal(teamB.percentCompleted, 0);
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
