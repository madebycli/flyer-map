import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { authorizeSnapshotWrite } from "../worker/authorization.ts";
import type { AccessContext } from "../worker/access.ts";

const now = "2026-08-24T00:00:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: {
      id: "campaign_auth",
      name: "Auth test",
      status: "active",
      defaultMapView: null,
      createdAt: now,
      updatedAt: now,
    },
    teams: [
      { id: "team_a", campaignId: "campaign_auth", name: "A", color: "#2563eb", createdAt: now, updatedAt: now },
      { id: "team_b", campaignId: "campaign_auth", name: "B", color: "#ea580c", createdAt: now, updatedAt: now },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_auth",
        teamId: "team_a",
        name: "A",
        geometry: { type: "Polygon", coordinates: [[[8, 49], [8.1, 49], [8.1, 49.1], [8, 49]]] },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "area_b",
        campaignId: "campaign_auth",
        teamId: "team_b",
        name: "B",
        geometry: { type: "Polygon", coordinates: [[[9, 50], [9.1, 50], [9.1, 50.1], [9, 50]]] },
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [
      {
        id: "task_a",
        campaignId: "campaign_auth",
        areaId: "area_a",
        taskType: "street",
        label: "A street",
        geometry: { type: "LineString", coordinates: [[8, 49], [8.1, 49.1]] },
        status: "open",
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "task_b",
        campaignId: "campaign_auth",
        areaId: "area_b",
        taskType: "street",
        label: "B street",
        geometry: { type: "LineString", coordinates: [[9, 50], [9.1, 50.1]] },
        status: "open",
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

function access(role: AccessContext["role"], teamId: string | null = null): AccessContext {
  return { grantId: `grant_${role}`, campaignId: "campaign_auth", role, teamId, label: null };
}

function fieldGroupAccess(teamId = "team_a"): AccessContext {
  return {
    grantId: "field-group:membership_a",
    campaignId: "campaign_auth",
    role: "field-group-member",
    teamId,
    label: "Tour A",
    groupId: "field_group_a",
    membershipId: "membership_a",
  };
}

test("admin may change campaign configuration", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.campaign.name = "Renamed";
  next.campaign.defaultMapView = { center: [9.4, 51.3], zoom: 12, bearing: 80 };
  assert.deepEqual(authorizeSnapshotWrite(access("admin"), previous, next), { allowed: true });
});

test("viewer may never write a snapshot", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.tasks[0].status = "later";
  assert.deepEqual(authorizeSnapshotWrite(access("viewer"), previous, next), {
    allowed: false,
    reason: "viewer_read_only",
  });
});

test("team editor may change a task and area in its own team", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.campaign.updatedAt = "2026-08-24T00:01:00.000Z";
  next.areas[0].name = "Own renamed area";
  next.areas[0].updatedAt = "2026-08-24T00:01:00.000Z";
  next.tasks[0].status = "completed";
  next.tasks[0].completedAt = "2026-08-24T00:01:00.000Z";
  next.tasks[0].updatedAt = "2026-08-24T00:01:00.000Z";
  assert.deepEqual(authorizeSnapshotWrite(access("team-editor", "team_a"), previous, next), {
    allowed: true,
  });
});

test("team editor cannot modify another team's area or task", () => {
  const previous = snapshot();
  const changedArea = structuredClone(previous);
  changedArea.areas[1].name = "Forbidden";
  assert.equal(
    authorizeSnapshotWrite(access("team-editor", "team_a"), previous, changedArea).allowed,
    false,
  );

  const changedTask = structuredClone(previous);
  changedTask.tasks[1].status = "later";
  assert.equal(
    authorizeSnapshotWrite(access("team-editor", "team_a"), previous, changedTask).allowed,
    false,
  );
});

test("team editor cannot manage teams, campaign focus or reassign an area", () => {
  const previous = snapshot();

  const teamChange = structuredClone(previous);
  teamChange.teams[0].name = "Managed";
  assert.equal(authorizeSnapshotWrite(access("team-editor", "team_a"), previous, teamChange).allowed, false);

  const focusChange = structuredClone(previous);
  focusChange.campaign.defaultMapView = { center: [9.4, 51.3], zoom: 10, bearing: 0 };
  assert.equal(authorizeSnapshotWrite(access("team-editor", "team_a"), previous, focusChange).allowed, false);

  const reassignment = structuredClone(previous);
  reassignment.areas[0].teamId = "team_b";
  assert.equal(authorizeSnapshotWrite(access("team-editor", "team_a"), previous, reassignment).allowed, false);
});

test("temporary field group member may change only own-team task status", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.tasks[0].status = "completed";
  next.tasks[0].completedAt = "2026-08-24T00:02:00.000Z";
  next.tasks[0].updatedAt = "2026-08-24T00:02:00.000Z";

  assert.deepEqual(authorizeSnapshotWrite(fieldGroupAccess(), previous, next), { allowed: true });
});

test("temporary field group member cannot change labels, areas or foreign-team status", () => {
  const previous = snapshot();

  const labelChange = structuredClone(previous);
  labelChange.tasks[0].label = "Renamed";
  assert.equal(authorizeSnapshotWrite(fieldGroupAccess(), previous, labelChange).allowed, false);

  const areaChange = structuredClone(previous);
  areaChange.areas[0].name = "Forbidden";
  assert.equal(authorizeSnapshotWrite(fieldGroupAccess(), previous, areaChange).allowed, false);

  const foreignStatus = structuredClone(previous);
  foreignStatus.tasks[1].status = "later";
  foreignStatus.tasks[1].updatedAt = "2026-08-24T00:02:00.000Z";
  assert.equal(authorizeSnapshotWrite(fieldGroupAccess(), previous, foreignStatus).allowed, false);
});

test("temporary field group member requires canonical group and membership scope", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  next.tasks[0].status = "later";
  next.tasks[0].updatedAt = "2026-08-24T00:02:00.000Z";
  const missingScope = {
    ...fieldGroupAccess(),
    groupId: null,
  };
  assert.deepEqual(authorizeSnapshotWrite(missingScope, previous, next), {
    allowed: false,
    reason: "field_group_scope_missing",
  });
});

test("credential cannot authorize another campaign", () => {
  const previous = snapshot();
  const next = structuredClone(previous);
  const wrongCampaign = { ...access("admin"), campaignId: "campaign_other" };
  assert.deepEqual(authorizeSnapshotWrite(wrongCampaign, previous, next), {
    allowed: false,
    reason: "credential_campaign_mismatch",
  });
});
