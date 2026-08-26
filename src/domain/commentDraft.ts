import type { CampaignSnapshot } from "./campaign.ts";

export type CommentTarget =
  | { type: "campaign"; id: string }
  | { type: "area"; id: string }
  | { type: "task"; id: string };

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

function targetExists(snapshot: CampaignSnapshot, target: CommentTarget) {
  if (target.type === "campaign") return target.id === snapshot.campaign.id;
  if (target.type === "area") return snapshot.areas.some((area) => area.id === target.id);
  return snapshot.tasks.some((task) => task.id === target.id);
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
    (rawTarget.type !== "campaign" && rawTarget.type !== "area" && rawTarget.type !== "task") ||
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
  if (body.length < 1 || body.length > 2_000) {
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
