import type { CampaignSnapshot } from "./campaign.ts";
import { collectionSnapshotOrEmpty } from "./collection.ts";

export const COMMENT_BODY_MAX_LENGTH = 2_000;

export type CommentTarget =
  | { type: "campaign"; id: string }
  | { type: "area"; id: string }
  | { type: "task"; id: string }
  | { type: "street-task"; id: string }
  | { type: "house-task"; id: string }
  | { type: "pickup-task"; id: string };

export type PersistentCommentTargetType =
  | "campaign"
  | "area"
  | "street-task"
  | "house-task"
  | "pickup-task";

export type CommentDraft = {
  campaignId: string;
  target: CommentTarget;
  body: string;
};

export type CommentDraftValidation =
  | { valid: true; value: CommentDraft }
  | {
      valid: false;
      reason: "invalid-campaign" | "invalid-target" | "target-not-found" | "invalid-body";
    };

function validIdentifier(value: unknown) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 180 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

export function isValidCommentIdentifier(value: unknown) {
  return validIdentifier(value);
}

export function normalizeCommentBody(value: unknown) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length >= 1 && body.length <= COMMENT_BODY_MAX_LENGTH ? body : null;
}

export function normalizeCommentTargetType(value: unknown): PersistentCommentTargetType | null {
  if (
    value === "campaign" ||
    value === "area" ||
    value === "street-task" ||
    value === "house-task" ||
    value === "pickup-task"
  ) {
    return value;
  }
  // The original local foundation called Street Tasks simply "task". Accepting
  // it at the boundary keeps old drafts readable while persistence stays explicit.
  if (value === "task") return "street-task";
  return null;
}

function targetExists(snapshot: CampaignSnapshot, target: CommentTarget) {
  if (target.type === "campaign") return target.id === snapshot.campaign.id;
  if (target.type === "area") return snapshot.areas.some((area) => area.id === target.id);
  if (target.type === "task" || target.type === "street-task") {
    return snapshot.tasks.some((task) => task.id === target.id);
  }
  if (target.type === "house-task") {
    return (snapshot.houseTasks ?? []).some((task) => task.id === target.id);
  }
  return collectionSnapshotOrEmpty(snapshot.collection).pickups.some((pickup) => pickup.id === target.id);
}

export function validateCommentDraft(
  snapshot: CampaignSnapshot,
  input: unknown,
): CommentDraftValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, reason: "invalid-body" };
  }

  const draft = input as Record<string, unknown>;
  if (draft.campaignId !== snapshot.campaign.id) {
    return { valid: false, reason: "invalid-campaign" };
  }

  if (!draft.target || typeof draft.target !== "object" || Array.isArray(draft.target)) {
    return { valid: false, reason: "invalid-target" };
  }
  const rawTarget = draft.target as Record<string, unknown>;
  if (
    (rawTarget.type !== "campaign" &&
      rawTarget.type !== "area" &&
      rawTarget.type !== "task" &&
      rawTarget.type !== "street-task" &&
      rawTarget.type !== "house-task" &&
      rawTarget.type !== "pickup-task") ||
    !validIdentifier(rawTarget.id)
  ) {
    return { valid: false, reason: "invalid-target" };
  }

  const target = { type: rawTarget.type, id: rawTarget.id } as CommentTarget;
  if (!targetExists(snapshot, target)) {
    return { valid: false, reason: "target-not-found" };
  }

  if (typeof draft.body !== "string") {
    return { valid: false, reason: "invalid-body" };
  }
  const body = draft.body.trim();
  if (body.length < 1 || body.length > COMMENT_BODY_MAX_LENGTH) {
    return { valid: false, reason: "invalid-body" };
  }

  return {
    valid: true,
    value: {
      campaignId: snapshot.campaign.id,
      target,
      body,
    },
  };
}
