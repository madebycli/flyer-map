import assert from "node:assert/strict";
import test from "node:test";
import { validateSupportFeedbackDraft } from "../src/support/supportFeedback.ts";

test("support feedback normalizes whitespace and keeps explicit context consent", () => {
  const result = validateSupportFeedbackDraft({
    category: "bug",
    title: "  Karte lädt langsam  ",
    message: "  Beim Verschieben lädt der Hintergrund sehr langsam nach.  ",
    includeCampaignContext: true,
  });

  assert.deepEqual(result, {
    valid: true,
    value: {
      category: "bug",
      title: "Karte lädt langsam",
      message: "Beim Verschieben lädt der Hintergrund sehr langsam nach.",
      includeCampaignContext: true,
    },
  });
});

test("code-like feedback remains inert text instead of being blacklisted or executed", () => {
  const hostile = "<script>alert(1)</script> x'); DROP TABLE campaigns; --";
  const result = validateSupportFeedbackDraft({
    category: "idea",
    title: "Code als Text",
    message: hostile,
    includeCampaignContext: false,
  });

  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.value.message, hostile);
});

test("support feedback rejects unknown categories and invalid lengths", () => {
  assert.deepEqual(
    validateSupportFeedbackDraft({
      category: "admin",
      title: "Valid title",
      message: "This message is long enough.",
    }),
    { valid: false, reason: "invalid-category" },
  );

  assert.deepEqual(
    validateSupportFeedbackDraft({
      category: "bug",
      title: "x",
      message: "This message is long enough.",
    }),
    { valid: false, reason: "invalid-title" },
  );

  assert.deepEqual(
    validateSupportFeedbackDraft({
      category: "bug",
      title: "Valid title",
      message: "short",
    }),
    { valid: false, reason: "invalid-message" },
  );
});

test("campaign context is opt-in only", () => {
  const result = validateSupportFeedbackDraft({
    category: "question",
    title: "Eine Frage",
    message: "Wie funktioniert der Offline-Bereich genau?",
  });

  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.value.includeCampaignContext, false);
});
