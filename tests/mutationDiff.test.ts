import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  deriveCampaignMutation,
  MutationDerivationError,
} from "../src/domain/mutationDiff.ts";

const initialTime = "2026-08-25T12:00:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 7,
    campaign: {
      id: "campaign_diff-test",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt: initialTime,
      updatedAt: initialTime,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_diff-test",
        name: "Team A",
        color: "#2563eb",
        createdAt: initialTime,
        updatedAt: initialTime,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_diff-test",
        teamId: "team_a",
        name: "Gebiet A",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [8.6, 49.4],
              [8.61, 49.4],
              [8.61, 49.41],
              [8.6, 49.4],
            ],
          ],
        },
        createdAt: initialTime,
        updatedAt: initialTime,
      },
    ],
    tasks: [
      {
        id: "task_a",
        campaignId: "campaign_diff-test",
        areaId: "area_a",
        taskType: "street",
        label: "Straße A",
        geometry: {
          type: "LineString",
          coordinates: [
            [8.6, 49.4],
            [8.61, 49.41],
          ],
        },
        status: "open",
        completedAt: null,
        createdAt: initialTime,
        updatedAt: initialTime,
      },
    ],
  };
}

test("derives one task status mutation from the snapshot-oriented UI save", () => {
  const previous = snapshot();
  const changedAt = "2026-08-25T12:01:00.000Z";
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: changedAt },
    tasks: previous.tasks.map((task) =>
      task.id === "task_a"
        ? {
            ...task,
            status: "completed",
            completedAt: changedAt,
            updatedAt: changedAt,
          }
        : task,
    ),
  };

  const mutation = deriveCampaignMutation(previous, next);
  assert.ok(mutation);
  assert.equal(mutation.type, "task.set-status");
  if (mutation.type !== "task.set-status") return;
  assert.equal(mutation.baseRevision, 7);
  assert.equal(mutation.payload.taskId, "task_a");
  assert.equal(mutation.payload.status, "completed");
  assert.equal(mutation.payload.expectedUpdatedAt, initialTime);
});

test("area deletion can include only its cascading task deletions", () => {
  const previous = snapshot();
  const changedAt = "2026-08-25T12:02:00.000Z";
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: changedAt },
    areas: [],
    tasks: [],
  };

  const mutation = deriveCampaignMutation(previous, next);
  assert.ok(mutation);
  assert.equal(mutation.type, "area.delete");
  if (mutation.type !== "area.delete") return;
  assert.equal(mutation.payload.areaId, "area_a");
  assert.equal(mutation.payload.expectedUpdatedAt, initialTime);
});

test("rejects ambiguous compound snapshot changes instead of broad fallback write", () => {
  const previous = snapshot();
  const changedAt = "2026-08-25T12:03:00.000Z";
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: changedAt },
    areas: previous.areas.map((area) => ({ ...area, name: "Neu", updatedAt: changedAt })),
    tasks: previous.tasks.map((task) => ({ ...task, label: "Auch neu", updatedAt: changedAt })),
  };

  assert.throws(
    () => deriveCampaignMutation(previous, next),
    (error) => error instanceof MutationDerivationError,
  );
});
