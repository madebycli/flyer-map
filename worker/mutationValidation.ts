import type { CampaignMutation } from "../src/domain/mutations.ts";

export type MutationValidationResult =
  | { valid: true; mutation: CampaignMutation }
  | { valid: false; message: string };

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isMutationId(value: unknown): value is string {
  return isId(value) && value.startsWith("mutation_") && value.length > "mutation_".length;
}

function isTaskId(value: unknown): value is string {
  return isId(value) && value.startsWith("task_") && value.length > "task_".length;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function hasExpectedUpdatedAt(payload: Record<string, unknown>) {
  return isTimestamp(payload.expectedUpdatedAt);
}

function isMapViewCandidate(value: unknown) {
  return value === null || isRecord(value);
}

function isTaskSource(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "dataset,objectIds,objectType") return false;
  if (
    value.dataset !== "OpenStreetMap"
    || value.objectType !== "way"
    || !Array.isArray(value.objectIds)
    || value.objectIds.length === 0
    || !value.objectIds.every(
      (objectId) => typeof objectId === "number" && Number.isSafeInteger(objectId) && objectId > 0,
    )
  ) {
    return false;
  }
  return new Set(value.objectIds).size === value.objectIds.length;
}

export function validateCampaignMutation(
  value: unknown,
  campaignId: string,
): MutationValidationResult {
  if (!isRecord(value)) {
    return { valid: false, message: "Mutation ist kein gültiges Objekt." };
  }
  if (!isMutationId(value.id)) {
    return { valid: false, message: "Mutation-ID ist ungültig." };
  }
  if (value.campaignId !== campaignId) {
    return { valid: false, message: "Mutation gehört zu einer anderen Campaign." };
  }
  if (
    typeof value.baseRevision !== "number" ||
    !Number.isInteger(value.baseRevision) ||
    value.baseRevision < 0
  ) {
    return { valid: false, message: "Mutation baseRevision ist ungültig." };
  }
  if (!isTimestamp(value.createdAt)) {
    return { valid: false, message: "Mutation createdAt ist ungültig." };
  }
  if (typeof value.type !== "string" || !isRecord(value.payload)) {
    return { valid: false, message: "Mutation-Typ oder Payload ist ungültig." };
  }

  const payload = value.payload;
  switch (value.type) {
    case "campaign.rename":
      if (!isString(payload.name, 160) || !isString(payload.expectedName, 160)) break;
      return { valid: true, mutation: value as CampaignMutation };
    case "campaign.set-default-map-view":
      if (
        isMapViewCandidate(payload.defaultMapView) &&
        isMapViewCandidate(payload.expectedDefaultMapView)
      ) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "team.create":
      if (isId(payload.teamId) && isString(payload.name, 120) && isString(payload.color, 32)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "team.update": {
      const hasName = payload.name !== undefined;
      const hasColor = payload.color !== undefined;
      if (
        isId(payload.teamId) &&
        hasExpectedUpdatedAt(payload) &&
        (hasName || hasColor) &&
        (!hasName || isString(payload.name, 120)) &&
        (!hasColor || isString(payload.color, 32))
      ) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    }
    case "area.create":
      if (
        isId(payload.areaId) &&
        isId(payload.teamId) &&
        isString(payload.name, 160) &&
        isRecord(payload.geometry)
      ) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "area.rename":
      if (isId(payload.areaId) && isString(payload.name, 160) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "area.set-team":
      if (isId(payload.areaId) && isId(payload.teamId) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "area.update-geometry":
      if (isId(payload.areaId) && isRecord(payload.geometry) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "area.delete":
      if (isId(payload.areaId) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "task.create":
      if (
        isTaskId(payload.taskId) &&
        isId(payload.areaId) &&
        isString(payload.label, 160) &&
        isRecord(payload.geometry) &&
        isTaskSource(payload.source)
      ) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "task.rename":
      if (isId(payload.taskId) && isString(payload.label, 160) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "task.set-status":
      if (
        isId(payload.taskId) &&
        (payload.status === "open" ||
          payload.status === "completed" ||
          payload.status === "later" ||
          payload.status === "not-deliverable") &&
        (payload.completedAt === null || isTimestamp(payload.completedAt)) &&
        hasExpectedUpdatedAt(payload)
      ) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    case "task.delete":
      if (isId(payload.taskId) && hasExpectedUpdatedAt(payload)) {
        return { valid: true, mutation: value as CampaignMutation };
      }
      break;
    default:
      return { valid: false, message: "Mutation-Typ wird nicht unterstützt." };
  }

  return { valid: false, message: "Mutation-Payload ist ungültig." };
}
