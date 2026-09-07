import assert from "node:assert/strict";
import test from "node:test";
import { calculateFieldSessionMetrics } from "../src/domain/fieldSessionMetrics.ts";

test("field session metrics calculate duration and person-time without GPS data", () => {
  const metrics = calculateFieldSessionMetrics({
    startedAt: "2026-08-25T16:00:00.000Z",
    endedAt: "2026-08-25T17:30:00.000Z",
    participantCount: 4,
    affectedTaskIds: ["task_a", "task_b", "task_a"],
  });

  assert.deepEqual(metrics, {
    durationMinutes: 90,
    participantCount: 4,
    personMinutes: 360,
    affectedTaskCount: 2,
  });
});

test("field session metrics reject reversed or excessively long sessions", () => {
  assert.equal(
    calculateFieldSessionMetrics({
      startedAt: "2026-08-25T17:00:00.000Z",
      endedAt: "2026-08-25T16:00:00.000Z",
      participantCount: 2,
    }),
    null,
  );
  assert.equal(
    calculateFieldSessionMetrics({
      startedAt: "2026-08-24T00:00:00.000Z",
      endedAt: "2026-08-26T00:00:00.000Z",
      participantCount: 2,
    }),
    null,
  );
});

test("participant count must be a bounded positive integer", () => {
  for (const participantCount of [0, -1, 1.5, 501]) {
    assert.equal(
      calculateFieldSessionMetrics({
        startedAt: "2026-08-25T16:00:00.000Z",
        endedAt: "2026-08-25T17:00:00.000Z",
        participantCount,
      }),
      null,
    );
  }
});

test("invalid or duplicate task ids cannot inflate affected-task count", () => {
  const metrics = calculateFieldSessionMetrics({
    startedAt: "2026-08-25T16:00:00.000Z",
    endedAt: "2026-08-25T17:00:00.000Z",
    participantCount: 2,
    affectedTaskIds: [
      "task_a",
      "task_a",
      "task_b",
      "<script>alert(1)</script>",
      "",
    ],
  });

  assert.equal(metrics?.affectedTaskCount, 2);
});
