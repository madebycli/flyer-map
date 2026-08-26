import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_DELETE_CONFIRMATION,
  actionDeleteReadiness,
} from "../src/domain/organizerActionDelete.ts";

const action = {
  actionId: "campaign_12345678-abcd-1234-abcd-123456789abc",
  actionName: "Frühjahr 2027 Flyer-Verteilung",
  status: "archived" as const,
};

test("only organizer with exact phrase can pass destructive client guard", () => {
  assert.deepEqual(actionDeleteReadiness(action, true, ACTION_DELETE_CONFIRMATION), { ready: true });
  assert.deepEqual(actionDeleteReadiness(action, false, ACTION_DELETE_CONFIRMATION), {
    ready: false,
    reason: "not-organizer",
  });
});

test("confirmation is exact and cannot be bypassed with whitespace or casing", () => {
  assert.deepEqual(actionDeleteReadiness(action, true, "aktion löschen"), {
    ready: false,
    reason: "confirmation-mismatch",
  });
  assert.deepEqual(actionDeleteReadiness(action, true, ` ${ACTION_DELETE_CONFIRMATION}`), {
    ready: false,
    reason: "confirmation-mismatch",
  });
});

test("valid legacy-style campaign selector remains usable while arbitrary paths are rejected", () => {
  assert.deepEqual(
    actionDeleteReadiness({ ...action, actionId: "campaign_legacy_01" }, true, ACTION_DELETE_CONFIRMATION),
    { ready: true },
  );
  assert.deepEqual(
    actionDeleteReadiness({ ...action, actionId: "../other" }, true, ACTION_DELETE_CONFIRMATION),
    { ready: false, reason: "invalid-action" },
  );
  assert.deepEqual(
    actionDeleteReadiness({ ...action, actionName: "" }, true, ACTION_DELETE_CONFIRMATION),
    { ready: false, reason: "invalid-action" },
  );
});
