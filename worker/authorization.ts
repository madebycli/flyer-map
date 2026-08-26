import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { AccessContext } from "./access.ts";

export type WriteAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string };

function same(valueA: unknown, valueB: unknown) {
  return JSON.stringify(valueA) === JSON.stringify(valueB);
}

function campaignConfigUnchanged(previous: CampaignSnapshot, next: CampaignSnapshot) {
  const { updatedAt: _previousUpdatedAt, ...previousCampaign } = previous.campaign;
  const { updatedAt: _nextUpdatedAt, ...nextCampaign } = next.campaign;
  return same(previousCampaign, nextCampaign);
}

function immutableAreaFieldsUnchanged(
  previous: CampaignSnapshot["areas"][number],
  next: CampaignSnapshot["areas"][number],
) {
  return (
    previous.id === next.id &&
    previous.campaignId === next.campaignId &&
    previous.teamId === next.teamId &&
    previous.createdAt === next.createdAt
  );
}

function immutableTaskFieldsUnchanged(
  previous: CampaignSnapshot["tasks"][number],
  next: CampaignSnapshot["tasks"][number],
) {
  return (
    previous.id === next.id &&
    previous.campaignId === next.campaignId &&
    previous.areaId === next.areaId &&
    previous.taskType === next.taskType &&
    previous.createdAt === next.createdAt &&
    same(previous.source ?? null, next.source ?? null)
  );
}

function houseImmutableFieldsUnchanged(
  previous: NonNullable<CampaignSnapshot["houseTasks"]>[number],
  next: NonNullable<CampaignSnapshot["houseTasks"]>[number],
  nextStreetIds: Set<string>,
) {
  const parentUnchanged = previous.parentStreetTaskId === next.parentStreetTaskId;
  const parentClearedByStreetDelete =
    previous.parentStreetTaskId !== null &&
    next.parentStreetTaskId === null &&
    !nextStreetIds.has(previous.parentStreetTaskId);

  return (
    previous.id === next.id &&
    previous.campaignId === next.campaignId &&
    previous.areaId === next.areaId &&
    previous.taskType === next.taskType &&
    previous.createdAt === next.createdAt &&
    same(previous.geometry, next.geometry) &&
    same(previous.source ?? null, next.source ?? null) &&
    (parentUnchanged || parentClearedByStreetDelete)
  );
}

function existingSmartStreetSnapshotUnchanged(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
): WriteAuthorization {
  const nextTaskMap = new Map(next.tasks.map((task) => [task.id, task]));
  for (const previousTask of previous.tasks) {
    const nextTask = nextTaskMap.get(previousTask.id);
    if (!nextTask) continue;

    if (!same(previousTask.source ?? null, nextTask.source ?? null)) {
      return { allowed: false, reason: "task_source_provenance_immutable" };
    }

    if (previousTask.source && !same(previousTask.geometry, nextTask.geometry)) {
      return { allowed: false, reason: "smart_street_geometry_immutable" };
    }
  }
  return { allowed: true };
}

function existingHouseSnapshotsUnchanged(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
): WriteAuthorization {
  const nextHouses = new Map((next.houseTasks ?? []).map((task) => [task.id, task]));
  const nextStreetIds = new Set(next.tasks.map((task) => task.id));

  for (const previousTask of previous.houseTasks ?? []) {
    const nextTask = nextHouses.get(previousTask.id);
    if (!nextTask) continue;
    if (!houseImmutableFieldsUnchanged(previousTask, nextTask, nextStreetIds)) {
      return { allowed: false, reason: "house_snapshot_immutable" };
    }
  }

  return { allowed: true };
}

export function authorizeSnapshotWrite(
  access: AccessContext,
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
): WriteAuthorization {
  if (access.campaignId !== previous.campaign.id || access.campaignId !== next.campaign.id) {
    return { allowed: false, reason: "credential_campaign_mismatch" };
  }

  // Legacy full-snapshot writes may still exist during the M5 transition. Existing
  // reviewed Smart Street/House source snapshots remain immutable for every role.
  const smartStreetCheck = existingSmartStreetSnapshotUnchanged(previous, next);
  if (!smartStreetCheck.allowed) return smartStreetCheck;
  const houseCheck = existingHouseSnapshotsUnchanged(previous, next);
  if (!houseCheck.allowed) return houseCheck;

  if (access.role === "admin") return { allowed: true };
  if (access.role === "viewer") return { allowed: false, reason: "viewer_read_only" };
  if (!access.teamId) return { allowed: false, reason: "editor_team_scope_missing" };

  const teamId = access.teamId;
  if (!campaignConfigUnchanged(previous, next)) {
    return { allowed: false, reason: "editor_campaign_settings_forbidden" };
  }
  if (!same(previous.teams, next.teams)) {
    return { allowed: false, reason: "editor_team_management_forbidden" };
  }

  const previousAreas = new Map(previous.areas.map((area) => [area.id, area]));
  const nextAreas = new Map(next.areas.map((area) => [area.id, area]));

  for (const previousArea of previous.areas) {
    const nextArea = nextAreas.get(previousArea.id);
    if (previousArea.teamId !== teamId) {
      if (!nextArea || !same(previousArea, nextArea)) {
        return { allowed: false, reason: "editor_foreign_area_forbidden" };
      }
      continue;
    }

    if (nextArea && !immutableAreaFieldsUnchanged(previousArea, nextArea)) {
      return { allowed: false, reason: "editor_area_reassignment_forbidden" };
    }
  }

  for (const nextArea of next.areas) {
    const previousArea = previousAreas.get(nextArea.id);
    if (!previousArea && nextArea.teamId !== teamId) {
      return { allowed: false, reason: "editor_foreign_area_create_forbidden" };
    }
  }

  const previousTaskMap = new Map(previous.tasks.map((task) => [task.id, task]));
  const nextTaskMap = new Map(next.tasks.map((task) => [task.id, task]));

  const previousAreaTeam = new Map(previous.areas.map((area) => [area.id, area.teamId]));
  const nextAreaTeam = new Map(next.areas.map((area) => [area.id, area.teamId]));

  for (const previousTask of previous.tasks) {
    const nextTask = nextTaskMap.get(previousTask.id);
    const ownedByEditor = previousAreaTeam.get(previousTask.areaId) === teamId;

    if (!ownedByEditor) {
      if (!nextTask || !same(previousTask, nextTask)) {
        return { allowed: false, reason: "editor_foreign_task_forbidden" };
      }
      continue;
    }

    if (nextTask && !immutableTaskFieldsUnchanged(previousTask, nextTask)) {
      return { allowed: false, reason: "editor_task_reassignment_forbidden" };
    }
  }

  for (const nextTask of next.tasks) {
    const previousTask = previousTaskMap.get(nextTask.id);
    if (!previousTask && nextAreaTeam.get(nextTask.areaId) !== teamId) {
      return { allowed: false, reason: "editor_foreign_task_create_forbidden" };
    }
  }

  const previousHouseMap = new Map((previous.houseTasks ?? []).map((task) => [task.id, task]));
  const nextHouseMap = new Map((next.houseTasks ?? []).map((task) => [task.id, task]));
  const nextStreetIds = new Set(next.tasks.map((task) => task.id));

  for (const previousTask of previous.houseTasks ?? []) {
    const nextTask = nextHouseMap.get(previousTask.id);
    const ownedByEditor = previousAreaTeam.get(previousTask.areaId) === teamId;

    if (!ownedByEditor) {
      if (!nextTask || !same(previousTask, nextTask)) {
        return { allowed: false, reason: "editor_foreign_house_forbidden" };
      }
      continue;
    }

    if (nextTask && !houseImmutableFieldsUnchanged(previousTask, nextTask, nextStreetIds)) {
      return { allowed: false, reason: "editor_house_reassignment_forbidden" };
    }
  }

  for (const nextTask of next.houseTasks ?? []) {
    const previousTask = previousHouseMap.get(nextTask.id);
    if (!previousTask && nextAreaTeam.get(nextTask.areaId) !== teamId) {
      return { allowed: false, reason: "editor_foreign_house_create_forbidden" };
    }
  }

  return { allowed: true };
}
