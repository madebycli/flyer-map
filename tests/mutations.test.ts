import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import { authorizeSnapshotWrite } from "../worker/authorization.ts";
import { validateCampaignMutation } from "../worker/mutationValidation.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  applyCampaignMutation,
  CampaignMutationConflictError,
  type CampaignMutation,
} from "../src/domain/mutations.ts";

const createdAt = "2026-08-24T09:00:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: {
      id: "campaign_mutation-test",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt,
      updatedAt: createdAt,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_mutation-test",
        name: "Team A",
        color: "#2563eb",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "team_b",
        campaignId: "campaign_mutation-test",
        name: "Team B",
        color: "#dc2626",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_mutation-test",
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
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "area_b",
        campaignId: "campaign_mutation-test",
        teamId: "team_b",
        name: "Gebiet B",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [9.1, 50.1],
              [9.11, 50.1],
              [9.11, 50.11],
              [9.1, 50.1],
            ],
          ],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    tasks: [
      {
        id: "task_a",
        campaignId: "campaign_mutation-test",
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
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
}

const admin: AccessContext = {
  grantId: "grant_admin",
  campaignId: "campaign_mutation-test",
  role: "admin",
  teamId: null,
  label: null,
};

const editorA: AccessContext = {
  grantId: "grant_editor-a",
  campaignId: "campaign_mutation-test",
  role: "team-editor",
  teamId: "team_a",
  label: null,
};

const viewer: AccessContext = {
  grantId: "grant_viewer",
  campaignId: "campaign_mutation-test",
  role: "viewer",
  teamId: null,
  label: null,
};

test("an offline mutation can be applied later when its target is still current", () => {
  const mutation: CampaignMutation = {
    id: "mutation_offline-area",
    campaignId: "campaign_mutation-test",
    type: "area.create",
    payload: {
      areaId: "area_offline",
      teamId: "team_a",
      name: "Offline Gebiet",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [8.7, 49.5],
            [8.71, 49.5],
            [8.71, 49.51],
            [8.7, 49.5],
          ],
        ],
      },
    },
    baseRevision: 4,
    createdAt: "2026-08-24T09:05:00.000Z",
  };

  const currentServer = { ...snapshot(), revision: 5 };
  const applied = applyCampaignMutation(currentServer, mutation);

  assert.equal(applied.revision, 6);
  assert.equal(applied.areas.at(-1)?.id, "area_offline");
  assert.equal(authorizeSnapshotWrite(admin, currentServer, applied).allowed, true);
});

test("a changed mutation target produces a visible conflict instead of last-write-wins", () => {
  const mutation: CampaignMutation = {
    id: "mutation_task-rename",
    campaignId: "campaign_mutation-test",
    type: "task.rename",
    payload: {
      taskId: "task_a",
      label: "Neuer Name",
      expectedUpdatedAt: createdAt,
    },
    baseRevision: 4,
    createdAt: "2026-08-24T09:06:00.000Z",
  };
  const currentServer = snapshot();
  currentServer.revision = 5;
  currentServer.tasks[0] = {
    ...currentServer.tasks[0],
    label: "Anderes Gerät",
    updatedAt: "2026-08-24T09:05:30.000Z",
  };

  assert.throws(
    () => applyCampaignMutation(currentServer, mutation),
    (error) =>
      error instanceof CampaignMutationConflictError && error.reason === "task_changed",
  );
});

test("viewer mutation candidate remains read-only under M4 authorization", () => {
  const current = snapshot();
  const mutation: CampaignMutation = {
    id: "mutation_viewer",
    campaignId: current.campaign.id,
    type: "task.set-status",
    payload: {
      taskId: "task_a",
      status: "completed",
      completedAt: "2026-08-24T09:07:00.000Z",
      expectedUpdatedAt: createdAt,
    },
    baseRevision: current.revision,
    createdAt: "2026-08-24T09:07:00.000Z",
  };
  const next = applyCampaignMutation(current, mutation);

  assert.deepEqual(authorizeSnapshotWrite(viewer, current, next), {
    allowed: false,
    reason: "viewer_read_only",
  });
});

test("team editor cannot mutate an area owned by another team", () => {
  const current = snapshot();
  const mutation: CampaignMutation = {
    id: "mutation_foreign-area",
    campaignId: current.campaign.id,
    type: "area.rename",
    payload: {
      areaId: "area_b",
      name: "Fremdes Gebiet",
      expectedUpdatedAt: createdAt,
    },
    baseRevision: current.revision,
    createdAt: "2026-08-24T09:08:00.000Z",
  };
  const next = applyCampaignMutation(current, mutation);

  assert.deepEqual(authorizeSnapshotWrite(editorA, current, next), {
    allowed: false,
    reason: "editor_foreign_area_forbidden",
  });
});

test("manual Street creation is rejected when any segment leaves its selected Area", () => {
  const current = snapshot();
  const mutation: CampaignMutation = {
    id: "mutation_street-outside",
    campaignId: current.campaign.id,
    type: "task.create",
    payload: {
      taskId: "task_outside",
      areaId: "area_a",
      label: "Außerhalb",
      geometry: { type: "LineString", coordinates: [[8.601, 49.401], [8.63, 49.43]] },
    },
    baseRevision: current.revision,
    createdAt: "2026-08-24T09:09:00.000Z",
  };
  assert.throws(
    () => applyCampaignMutation(current, mutation),
    (error) => error instanceof CampaignMutationConflictError && error.reason === "street_outside_area",
  );
});

test("worker rejects unknown mutation types before persistence", () => {
  const current = snapshot();
  const result = validateCampaignMutation(
    {
      id: "mutation_unknown",
      campaignId: current.campaign.id,
      type: "snapshot.replace",
      payload: {},
      baseRevision: current.revision,
      createdAt,
    },
    current.campaign.id,
  );

  assert.equal(result.valid, false);
});
