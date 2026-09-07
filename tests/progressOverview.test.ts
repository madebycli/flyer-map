import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot, DistributionTask } from "../src/domain/campaign.ts";
import { buildProgressOverview } from "../src/domain/progressOverview.ts";

function task(id: string, areaId: string, status: DistributionTask["status"]): DistributionTask {
  return {
    id,
    campaignId: "campaign_overview",
    areaId,
    taskType: "street",
    label: id,
    geometry: { type: "LineString", coordinates: [[10, 50], [10.1, 50.1]] },
    status,
    completedAt: status === "completed" ? "2026-08-25T11:00:00.000Z" : null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T11:00:00.000Z",
  };
}

function snapshotFixture(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 5,
    campaign: {
      id: "campaign_overview",
      name: "Overview",
      status: "active",
      defaultMapView: null,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T11:00:00.000Z",
    },
    teams: [
      { id: "team_a", campaignId: "campaign_overview", name: "Orange", color: "#ea580c", createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z" },
      { id: "team_b", campaignId: "campaign_overview", name: "Blau", color: "#2563eb", createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z" },
    ],
    areas: [
      { id: "area_a", campaignId: "campaign_overview", teamId: "team_a", name: "Nord", geometry: { type: "Polygon", coordinates: [[[10, 50], [10.2, 50], [10.2, 50.2], [10, 50]]] }, createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z" },
      { id: "area_b", campaignId: "campaign_overview", teamId: "team_b", name: "Süd", geometry: { type: "Polygon", coordinates: [[[10.3, 50], [10.5, 50], [10.5, 50.2], [10.3, 50]]] }, createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z" },
    ],
    tasks: [
      task("a_done", "area_a", "completed"),
      task("a_open", "area_a", "open"),
      task("b_done", "area_b", "completed"),
      task("b_later", "area_b", "later"),
      task("b_blocked", "area_b", "not-deliverable"),
    ],
  };
}

test("progress overview reconciles campaign totals with team totals", () => {
  const overview = buildProgressOverview(snapshotFixture());
  assert.equal(overview.campaign.total, 5);
  assert.equal(overview.teams.reduce((sum, row) => sum + row.progress.total, 0), 5);
  assert.equal(overview.teams.reduce((sum, row) => sum + row.progress.completed, 0), 2);
});

test("progress overview retains team display context for each area", () => {
  const overview = buildProgressOverview(snapshotFixture());
  assert.deepEqual(
    overview.areas.map((row) => ({ name: row.name, teamName: row.teamName, color: row.teamColor, total: row.progress.total })),
    [
      { name: "Nord", teamName: "Orange", color: "#ea580c", total: 2 },
      { name: "Süd", teamName: "Blau", color: "#2563eb", total: 3 },
    ],
  );
});

test("not-deliverable work stays visible in the area overview instead of disappearing", () => {
  const overview = buildProgressOverview(snapshotFixture());
  const south = overview.areas.find((row) => row.areaId === "area_b");
  assert.equal(south?.progress.notDeliverable, 1);
  assert.equal(south?.progress.completed, 1);
  assert.equal(south?.progress.total, 3);
});
