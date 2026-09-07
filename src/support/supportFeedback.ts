export type SupportFeedbackCategory = "bug" | "idea" | "question";

export type SupportFeedbackDraft = {
  category: SupportFeedbackCategory;
  title: string;
  message: string;
  includeCampaignContext: boolean;
};

export type SupportFeedbackValidation =
  | { valid: true; value: SupportFeedbackDraft }
  | { valid: false; reason: "invalid-category" | "invalid-title" | "invalid-message" };

const CATEGORIES = new Set<SupportFeedbackCategory>(["bug", "idea", "question"]);

export function validateSupportFeedbackDraft(value: unknown): SupportFeedbackValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "invalid-message" };
  }

  const draft = value as Record<string, unknown>;
  if (typeof draft.category !== "string" || !CATEGORIES.has(draft.category as SupportFeedbackCategory)) {
    return { valid: false, reason: "invalid-category" };
  }
  if (typeof draft.title !== "string") {
    return { valid: false, reason: "invalid-title" };
  }
  if (typeof draft.message !== "string") {
    return { valid: false, reason: "invalid-message" };
  }

  const title = draft.title.trim();
  const message = draft.message.trim();
  if (title.length < 3 || title.length > 120) {
    return { valid: false, reason: "invalid-title" };
  }
  if (message.length < 10 || message.length > 4_000) {
    return { valid: false, reason: "invalid-message" };
  }

  return {
    valid: true,
    value: {
      category: draft.category as SupportFeedbackCategory,
      title,
      message,
      includeCampaignContext: draft.includeCampaignContext === true,
    },
  };
}
