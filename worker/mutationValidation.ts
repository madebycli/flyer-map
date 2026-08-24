import type { CampaignMutation } from "../src/domain/mutations.ts";

export type MutationValidationResult =
  | { valid: true; mutation: CampaignMutation }
  | { valid: false; message: string };

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength;
}

function hasExpectedUpdatedAt(payload: Record<string, unknown>) {
  return isTimestamp(payload.expectedUpdatedAt);
}

export function validateCampaignMutation(
  value: unknown,
  campaignId: string,
): MutationValidationResult {
  if (!isRecord(value)) {
    return { valid: false, message: "Mutation ist kein gültiges Objekt." };
  }
  if (!isId(value.id) || !String(value.id).startsWith("mutation_")) {
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
      if (!isString(payload.name, 160) || !hasExpectedUpdatedAt(payload)) break;
      return { valid: true, mutation: value as CampaignMutation };
    case "campaign.set-default-map-view":
      if (
        (payload.defaultMapView === null || isRecord(payload.defaultMapView)) &&
        hasExpectedUpdatedAt(payload)
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
        isId(payload.taskId) &&
        isId(payload.areaId) &&
        isString(payload.label, 160) &&
        isRecord(payload.geometry)
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
