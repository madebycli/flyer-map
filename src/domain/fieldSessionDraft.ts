import { calculateFieldSessionMetrics, type FieldSessionMetrics } from "./fieldSessionMetrics.ts";

export type FieldSessionMode = "distribution" | "collection";

export type FieldSessionDraft = {
  mode: FieldSessionMode;
  startedAt: string;
  endedAt: string;
  participantCount: number;
  note: string;
};

export type ValidatedFieldSessionDraft = FieldSessionDraft & {
  metrics: FieldSessionMetrics;
};

export type FieldSessionDraftValidation =
  | { valid: true; value: ValidatedFieldSessionDraft }
  | { valid: false; reason: "invalid-time" | "invalid-participants" | "note-too-long" };

export function validateFieldSessionDraft(
  draft: FieldSessionDraft,
): FieldSessionDraftValidation {
  if (draft.note.trim().length > 1_000) {
    return { valid: false, reason: "note-too-long" };
  }
  const metrics = calculateFieldSessionMetrics({
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    participantCount: draft.participantCount,
  });
  if (!metrics) {
    const participantValid =
      Number.isSafeInteger(draft.participantCount) &&
      draft.participantCount >= 1 &&
      draft.participantCount <= 500;
    return { valid: false, reason: participantValid ? "invalid-time" : "invalid-participants" };
  }
  return {
    valid: true,
    value: {
      ...draft,
      note: draft.note.trim(),
      metrics,
    },
  };
}
