import assert from "node:assert/strict";
import test from "node:test";
import {
  pickupStatusTransition,
  summarizePickupStatuses,
  validatePickupDraft,
} from "../src/domain/pickup.ts";

test("manual call-in pickup address is normalized as inert text", () => {
  const result = validatePickupDraft({
    address: "  Hauptstraße   12, 12345 Musterstadt  ",
    note: "<script>alert('x')</script>; DROP TABLE pickup_tasks;",
    sourceBuildingId: null,
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.address, "Hauptstraße 12, 12345 Musterstadt");
  assert.equal(result.value.note, "<script>alert('x')</script>; DROP TABLE pickup_tasks;");
});

test("pickup draft may reference a reviewed OSM building without making it a credential", () => {
  const result = validatePickupDraft({
    address: "Nebenstraße 2",
    note: "",
    sourceBuildingId: "way/2042",
  });
  assert.equal(result.valid, true);
});

test("invalid source building ids are rejected", () => {
  assert.deepEqual(
    validatePickupDraft({ address: "Nebenstraße 2", note: "", sourceBuildingId: "../../secret" }),
    { valid: false, reason: "source-id-invalid" },
  );
});

test("pickup progress has its own explicit denominator", () => {
  assert.deepEqual(
    summarizePickupStatuses(["collected", "open", "needs-follow-up", "unavailable"]),
    {
      denominator: "pickup-tasks",
      total: 4,
      collected: 1,
      open: 1,
      unavailable: 1,
      needsFollowUp: 1,
      remaining: 3,
      percentCollected: 25,
    },
  );
});

test("empty pickup progress is unknown rather than pretending to be complete", () => {
  const summary = summarizePickupStatuses([]);
  assert.equal(summary.percentCollected, null);
  assert.equal(summary.total, 0);
});

test("pickup status transitions are independent and deterministic", () => {
  assert.equal(pickupStatusTransition("open", "collected"), "collected");
  assert.equal(pickupStatusTransition("collected", "needs-follow-up"), "needs-follow-up");
});
