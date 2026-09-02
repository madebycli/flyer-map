import type { RxdbCollectionName, RxdbDocument, RxdbPushRow } from "../data/rxdbSyncProtocol.ts";
import type { CampaignSnapshot, DistributionTask, HouseTask } from "./campaign.ts";
import type { CampaignMutation } from "./mutations.ts";

export type RxdbMutationDecision =
  | { kind: "ack" }
  | { kind: "conflict"; reason: string }
  | { kind: "apply"; mutation: CampaignMutation };

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function plain<T extends RxdbDocument>(document: T) {
  // Keep the tombstone marker for the deletion branch; only RxDB's
  // transport-owned revision/metadata must be removed before domain checks.
  const { _rev: _rev, _meta: _meta, _attachments: _attachments, ...value } = document;
  return value;
}

function comparableDocument(document: RxdbDocument) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, _deleted: _deleted, _rev: _rev, _meta: _meta, _attachments: _attachments, ...value } = document;
  return value;
}

function sameBusinessDocument(left: RxdbDocument, right: RxdbDocument) {
  return same(comparableDocument(left), comparableDocument(right));
}

function base(snapshot: CampaignSnapshot, createdAt: string): Pick<CampaignMutation, "id" | "campaignId" | "baseRevision" | "createdAt"> {
  return {
    id: `mutation_rxdb_${crypto.randomUUID()}`,
    campaignId: snapshot.campaign.id,
    baseRevision: snapshot.revision,
    createdAt,
  };
}

function targetFor(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
  id: string,
): RxdbDocument | null {
  switch (collectionName) {
    case "campaigns":
      return snapshot.campaign.id === id ? { ...snapshot.campaign, campaignId: snapshot.campaign.id } : null;
    case "teams":
      return snapshot.teams.find((value) => value.id === id) ?? null;
    case "areas":
      return snapshot.areas.find((value) => value.id === id) ?? null;
    case "streetTasks":
      return snapshot.tasks.find((value) => value.id === id) ?? null;
    case "houseTasks":
      return (snapshot.houseTasks ?? []).find((value) => value.id === id) ?? null;
  }
}

function isSameOrNewCanonical(current: RxdbDocument | null, next: RxdbDocument) {
  return current !== null && sameBusinessDocument(current, next);
}

/**
 * Converts one optimistic RxDB document write to the existing narrow mutation
 * contract. The Worker always compares against current canonical D1 data.
 */
export function deriveMutationFromRxdbWrite(
  collectionName: RxdbCollectionName,
  snapshot: CampaignSnapshot,
  row: RxdbPushRow,
  canonicalCreatedAt: string,
): RxdbMutationDecision {
  const next = plain(row.newDocumentState);
  const assumed = row.assumedMasterState ? plain(row.assumedMasterState) : undefined;
  const current = targetFor(collectionName, snapshot, next.id);
  const mutationBase = base(snapshot, canonicalCreatedAt);

  if (next.campaignId !== snapshot.campaign.id) return { kind: "conflict", reason: "campaign_mismatch" };
  if (next._deleted) {
    if (!current) return { kind: "ack" };
    if (!assumed || !sameBusinessDocument(current, assumed)) {
      return { kind: "conflict", reason: "structural_target_changed" };
    }
    switch (collectionName) {
      case "campaigns":
        return { kind: "conflict", reason: "campaign_delete_forbidden" };
      case "teams":
        return { kind: "apply", mutation: { ...mutationBase, type: "team.delete", payload: { teamId: next.id, expectedUpdatedAt: current.updatedAt } } };
      case "areas":
        return { kind: "apply", mutation: { ...mutationBase, type: "area.delete", payload: { areaId: next.id, expectedUpdatedAt: current.updatedAt } } };
      case "streetTasks":
        return { kind: "apply", mutation: { ...mutationBase, type: "task.delete", payload: { taskId: next.id, expectedUpdatedAt: current.updatedAt } } };
      case "houseTasks":
        return { kind: "apply", mutation: { ...mutationBase, type: "house.delete", payload: { taskId: next.id, expectedUpdatedAt: current.updatedAt } } };
    }
  }

  if (!current) {
    // An update against a server-deleted document must not resurrect it. A
    // missing assumed master means this is a genuine local create.
    if (assumed) return { kind: "conflict", reason: "target_deleted" };
    switch (collectionName) {
      case "campaigns":
        return { kind: "conflict", reason: "campaign_create_forbidden" };
      case "teams":
        return { kind: "apply", mutation: { ...mutationBase, type: "team.create", payload: { teamId: next.id, name: next.name, color: next.color } } };
      case "areas":
        return { kind: "apply", mutation: { ...mutationBase, type: "area.create", payload: { areaId: next.id, teamId: next.teamId, name: next.name, geometry: next.geometry } } };
      case "streetTasks": {
        const task = next as DistributionTask;
        return { kind: "apply", mutation: { ...mutationBase, type: "task.create", payload: { taskId: task.id, areaId: task.areaId, label: task.label, geometry: task.geometry, ...(task.source ? { source: task.source } : {}) } } };
      }
      case "houseTasks": {
        const task = next as HouseTask;
        return { kind: "apply", mutation: { ...mutationBase, type: "house.create", payload: { taskId: task.id, areaId: task.areaId, label: task.label, geometry: task.geometry, ...(task.source ? { source: task.source } : {}), parentStreetTaskId: task.parentStreetTaskId } } };
      }
    }
  }

  if (isSameOrNewCanonical(current, next)) return { kind: "ack" };
  if (!assumed || assumed.id !== current.id) return { kind: "conflict", reason: "missing_master_state" };

  switch (collectionName) {
    case "campaigns": {
      const currentCampaign = current;
      const assumedCampaign = assumed;
      const changedName = next.name !== assumedCampaign.name;
      const changedMap = !same(next.defaultMapView, assumedCampaign.defaultMapView);
      if (next.status !== assumedCampaign.status || Number(changedName) + Number(changedMap) !== 1) {
        return { kind: "conflict", reason: "campaign_structural_change" };
      }
      if (changedName) {
        if (currentCampaign.name !== assumedCampaign.name) return { kind: "conflict", reason: "campaign_name_changed" };
        return { kind: "apply", mutation: { ...mutationBase, type: "campaign.rename", payload: { name: next.name, expectedName: currentCampaign.name } } };
      }
      if (!same(currentCampaign.defaultMapView, assumedCampaign.defaultMapView)) return { kind: "conflict", reason: "campaign_map_changed" };
      return { kind: "apply", mutation: { ...mutationBase, type: "campaign.set-default-map-view", payload: { defaultMapView: next.defaultMapView, expectedDefaultMapView: currentCampaign.defaultMapView } } };
    }
    case "teams": {
      const currentTeam = current;
      const assumedTeam = assumed;
      if (next.createdAt !== assumedTeam.createdAt || next.campaignId !== assumedTeam.campaignId) {
        return { kind: "conflict", reason: "team_structural_change" };
      }
      const nameChanged = next.name !== assumedTeam.name;
      const colorChanged = next.color !== assumedTeam.color;
      if (!nameChanged && !colorChanged) return { kind: "ack" };
      const applyName = nameChanged && currentTeam.name === assumedTeam.name;
      const applyColor = colorChanged && currentTeam.color === assumedTeam.color;
      if (!applyName && !applyColor) return { kind: "conflict", reason: "team_field_changed" };
      return { kind: "apply", mutation: { ...mutationBase, type: "team.update", payload: { teamId: next.id, ...(applyName ? { name: next.name } : {}), ...(applyColor ? { color: next.color } : {}), expectedUpdatedAt: currentTeam.updatedAt } } };
    }
    case "areas": {
      const currentArea = current;
      const assumedArea = assumed;
      if (currentArea.updatedAt !== assumedArea.updatedAt) return { kind: "conflict", reason: "area_changed" };
      const nameChanged = next.name !== assumedArea.name;
      const teamChanged = next.teamId !== assumedArea.teamId;
      const geometryChanged = !same(next.geometry, assumedArea.geometry);
      if (Number(nameChanged) + Number(teamChanged) + Number(geometryChanged) !== 1) return { kind: "conflict", reason: "area_structural_change" };
      if (nameChanged) return { kind: "apply", mutation: { ...mutationBase, type: "area.rename", payload: { areaId: next.id, name: next.name, expectedUpdatedAt: currentArea.updatedAt } } };
      if (teamChanged) return { kind: "apply", mutation: { ...mutationBase, type: "area.set-team", payload: { areaId: next.id, teamId: next.teamId, expectedUpdatedAt: currentArea.updatedAt } } };
      return { kind: "apply", mutation: { ...mutationBase, type: "area.update-geometry", payload: { areaId: next.id, geometry: next.geometry, expectedUpdatedAt: currentArea.updatedAt } } };
    }
    case "streetTasks": {
      const task = next as DistributionTask;
      const currentTask = current as DistributionTask;
      const assumedTask = assumed as DistributionTask;
      if (task.areaId !== assumedTask.areaId || !same(task.geometry, assumedTask.geometry) || !same(task.source ?? null, assumedTask.source ?? null) || (task.areaPreparationGeneration ?? null) !== (assumedTask.areaPreparationGeneration ?? null)) return { kind: "conflict", reason: "task_structural_change" };
      const statusChanged = task.status !== assumedTask.status || task.completedAt !== assumedTask.completedAt;
      const labelChanged = task.label !== assumedTask.label;
      if (Number(statusChanged) + Number(labelChanged) !== 1) return { kind: "conflict", reason: "task_compound_change" };
      const remoteStatusChanged = currentTask.status !== assumedTask.status || currentTask.completedAt !== assumedTask.completedAt;
      if (statusChanged) {
        if (remoteStatusChanged) return { kind: "conflict", reason: "task_status_changed" };
        return { kind: "apply", mutation: { ...mutationBase, type: "task.set-status", payload: { taskId: task.id, status: task.status, completedAt: task.completedAt, expectedUpdatedAt: currentTask.updatedAt } } };
      }
      if (currentTask.label !== assumedTask.label) return { kind: "conflict", reason: "task_label_changed" };
      return { kind: "apply", mutation: { ...mutationBase, type: "task.rename", payload: { taskId: task.id, label: task.label, expectedUpdatedAt: currentTask.updatedAt } } };
    }
    case "houseTasks": {
      const task = next as HouseTask;
      const currentTask = current as HouseTask;
      const assumedTask = assumed as HouseTask;
      if (task.areaId !== assumedTask.areaId || task.parentStreetTaskId !== assumedTask.parentStreetTaskId || !same(task.geometry, assumedTask.geometry) || !same(task.source ?? null, assumedTask.source ?? null) || (task.areaPreparationGeneration ?? null) !== (assumedTask.areaPreparationGeneration ?? null)) return { kind: "conflict", reason: "house_structural_change" };
      const statusChanged = task.status !== assumedTask.status || task.completedAt !== assumedTask.completedAt;
      const labelChanged = task.label !== assumedTask.label;
      if (Number(statusChanged) + Number(labelChanged) !== 1) return { kind: "conflict", reason: "house_compound_change" };
      const remoteStatusChanged = currentTask.status !== assumedTask.status || currentTask.completedAt !== assumedTask.completedAt;
      if (statusChanged) {
        if (remoteStatusChanged) return { kind: "conflict", reason: "house_status_changed" };
        return { kind: "apply", mutation: { ...mutationBase, type: "house.set-status", payload: { taskId: task.id, status: task.status, completedAt: task.completedAt, expectedUpdatedAt: currentTask.updatedAt } } };
      }
      if (currentTask.label !== assumedTask.label) return { kind: "conflict", reason: "house_label_changed" };
      return { kind: "apply", mutation: { ...mutationBase, type: "house.rename", payload: { taskId: task.id, label: task.label, expectedUpdatedAt: currentTask.updatedAt } } };
    }
  }
}
