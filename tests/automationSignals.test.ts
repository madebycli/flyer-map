import assert from "node:assert/strict";
import test from "node:test";
import {
  crossedProgressThresholds,
  manualSyncActionRequired,
} from "../src/domain/automationSignals.ts";

test("progress automation emits each newly crossed threshold once for one transition", () => {
  assert.deepEqual(
    crossedProgressThresholds(20, 55).map((signal) => signal.threshold),
    [25, 50],
  );
  assert.deepEqual(
    crossedProgressThresholds(55, 80).map((signal) => signal.threshold),
    [75],
  );
});

test("progress automation does not fire for unchanged or backwards progress", () => {
  assert.deepEqual(crossedProgressThresholds(50, 50), []);
  assert.deepEqual(crossedProgressThresholds(75, 60), []);
});

test("initial known progress can surface already reached coordinator thresholds deterministically", () => {
  assert.deepEqual(
    crossedProgressThresholds(null, 100).map((signal) => signal.threshold),
    [25, 50, 75, 100],
  );
});

test("custom thresholds are deduplicated, bounded and sorted", () => {
  assert.deepEqual(
    crossedProgressThresholds(0, 100, [90, 10, 10, -1, 101, Number.NaN]).map(
      (signal) => signal.threshold,
    ),
    [10, 90],
  );
});

test("only terminal/manual sync states create a manual-action signal", () => {
  assert.deepEqual(manualSyncActionRequired("conflict"), {
    type: "manual-sync-action",
    state: "conflict",
  });
  assert.deepEqual(manualSyncActionRequired("blocked-auth"), {
    type: "manual-sync-action",
    state: "blocked-auth",
  });
  assert.deepEqual(manualSyncActionRequired("invalid"), {
    type: "manual-sync-action",
    state: "invalid",
  });
  assert.equal(manualSyncActionRequired("retry"), null);
  assert.equal(manualSyncActionRequired("saved"), null);
});
