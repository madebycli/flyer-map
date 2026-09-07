import assert from "node:assert/strict";
import test from "node:test";
import type { AdminAnalyticsExportInput } from "../src/domain/adminAnalyticsExport.ts";
import { compareActionSeries } from "../src/domain/actionAnalyticsComparison.ts";

function action(
  actionName: string,
  completed: number,
  open: number,
  personMinutes: number,
): AdminAnalyticsExportInput {
  return {
    actionName,
    templateName: "Standard Ort",
    mode: "distribution",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [
      {
        teamLabel: "Orange",
        distribution: {
          total: completed + open,
          completed,
          open,
          later: 0,
          notDeliverable: 0,
        },
        pickupTotal: 0,
        pickupCollected: 0,
        sessionCount: 2,
        personMinutes,
      },
    ],
    areas: [],
    sessions: [],
    events: [],
  };
}

test("repeated action comparison aggregates operational totals in caller order", () => {
  const result = compareActionSeries([
    action("Frühjahr 2026", 80, 20, 600),
    action("Herbst 2026", 90, 10, 520),
  ]);

  assert.equal(result.summaries.length, 2);
  assert.equal(result.summaries[0].distribution.completed, 80);
  assert.equal(result.summaries[1].personMinutes, 520);
  assert.deepEqual(result.deltas, [
    {
      fromAction: "Frühjahr 2026",
      toAction: "Herbst 2026",
      completedDelta: 10,
      openDelta: -10,
      notDeliverableDelta: 0,
      pickupCollectedDelta: 0,
      sessionCountDelta: 0,
      personMinutesDelta: -80,
    },
  ]);
});

test("comparison does not invent a good/bad team score", () => {
  const serialized = JSON.stringify(
    compareActionSeries([action("A", 10, 0, 100), action("B", 5, 5, 200)]),
  );
  assert.equal(serialized.includes("score"), false);
  assert.equal(serialized.includes("rank"), false);
  assert.equal(serialized.includes("performance"), false);
});

test("one action yields a summary without a fake delta", () => {
  const result = compareActionSeries([action("Einzelaktion", 5, 2, 120)]);
  assert.equal(result.summaries.length, 1);
  assert.deepEqual(result.deltas, []);
});
