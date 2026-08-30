import assert from "node:assert/strict";
import test from "node:test";
import {
  pickupStatusTransition,
  summarizePickupStatuses,
  validatePickupDraft,
} from "../src/domain/pickup.ts";

test("manual call-in pickup fields are normalized while description remains inert text", () => {
  const result = validatePickupDraft({
    title: "  Abholung   Müller  ",
    address: "  Hauptstraße   12, 12345 Musterstadt  ",
    description: "<script>alert('x')</script>; DROP TABLE collection_pickups;",
    position: [10.123, 50.456],
    areaId: null,
    source: null,
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.title, "Abholung Müller");
  assert.equal(result.value.address, "Hauptstraße 12, 12345 Musterstadt");
  assert.equal(result.value.description, "<script>alert('x')</script>; DROP TABLE collection_pickups;");
  assert.deepEqual(result.value.position, [10.123, 50.456]);
});

test("pickup draft may retain bounded OSM address provenance without using it as identity or credential", () => {
  const result = validatePickupDraft({
    title: "Nebenstraße",
    address: "Nebenstraße 2",
    description: "",
    position: [10.2, 50.2],
    areaId: null,
    source: {
      kind: "osm-address",
      provider: "osm-provider",
      placeId: "place-2042",
      osmType: "way",
      osmId: "2042",
    },
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.source?.kind, "osm-address");
});

test("invalid Distribution House provenance is rejected", () => {
  assert.deepEqual(
    validatePickupDraft({
      title: "Nebenstraße",
      address: "Nebenstraße 2",
      description: "",
      position: [10.2, 50.2],
      areaId: null,
      source: { kind: "distribution-house", taskId: "../../secret" },
    }),
    { valid: false, reason: "source-invalid" },
  );
});

test("title and map position remain mandatory for Pickup drafts", () => {
  assert.deepEqual(
    validatePickupDraft({
      title: "",
      address: "Nebenstraße 2",
      description: "",
      position: [10.2, 50.2],
      areaId: null,
      source: null,
    }),
    { valid: false, reason: "title-required" },
  );
  assert.deepEqual(
    validatePickupDraft({
      title: "Abholung",
      address: "Nebenstraße 2",
      description: "",
      position: null,
      areaId: null,
      source: null,
    }),
    { valid: false, reason: "position-required" },
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
