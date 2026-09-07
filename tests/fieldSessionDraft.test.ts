import assert from "node:assert/strict";
import test from "node:test";
import { validateFieldSessionDraft } from "../src/domain/fieldSessionDraft.ts";

test("valid distribution session draft returns duration and person-time metrics", () => {
  const result = validateFieldSessionDraft({
    mode: "distribution",
    startedAt: "2026-08-25T17:00:00.000Z",
    endedAt: "2026-08-25T18:30:00.000Z",
    participantCount: 4,
    note: "  Gebiet Nord fertig  ",
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.note, "Gebiet Nord fertig");
  assert.equal(result.value.metrics.durationMinutes, 90);
  assert.equal(result.value.metrics.personMinutes, 360);
});

test("collection mode uses the same explicit session metrics without mixing task status", () => {
  const result = validateFieldSessionDraft({
    mode: "collection",
    startedAt: "2026-08-25T10:00:00.000Z",
    endedAt: "2026-08-25T10:45:00.000Z",
    participantCount: 2,
    note: "Abholung",
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.mode, "collection");
  assert.equal(result.value.metrics.personMinutes, 90);
});

test("end before start is rejected", () => {
  assert.deepEqual(
    validateFieldSessionDraft({
      mode: "distribution",
      startedAt: "2026-08-25T18:00:00.000Z",
      endedAt: "2026-08-25T17:00:00.000Z",
      participantCount: 2,
      note: "",
    }),
    { valid: false, reason: "invalid-time" },
  );
});

test("participant count is bounded", () => {
  const result = validateFieldSessionDraft({
    mode: "distribution",
    startedAt: "2026-08-25T17:00:00.000Z",
    endedAt: "2026-08-25T18:00:00.000Z",
    participantCount: 0,
    note: "",
  });
  assert.deepEqual(result, { valid: false, reason: "invalid-participants" });
});

test("session note remains inert and bounded", () => {
  const result = validateFieldSessionDraft({
    mode: "distribution",
    startedAt: "2026-08-25T17:00:00.000Z",
    endedAt: "2026-08-25T18:00:00.000Z",
    participantCount: 2,
    note: "<script>alert(1)</script>; DROP TABLE field_sessions;",
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.note, "<script>alert(1)</script>; DROP TABLE field_sessions;");
});
