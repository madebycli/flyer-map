import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_GROUP_MAX_LIFETIME_MS,
  closeLiveGroupTour,
  createLiveGroupTour,
  resolveLiveGroupTour,
  updateLiveGroupParticipantCount,
} from "../src/domain/liveGroupTour.ts";

const CREATED_AT = "2026-08-26T08:00:00.000Z";

function createTour(participantCount?: number) {
  return createLiveGroupTour({
    groupId: "group_alpha",
    mode: "distribution",
    createdAt: CREATED_AT,
    participantCount,
  });
}

test("new tour gets one immutable 24-hour hard expiry", () => {
  const tour = createTour();

  assert.equal(tour.state, "active");
  assert.equal(tour.participantCount, null);
  assert.equal(tour.endedAt, null);
  assert.equal(
    Date.parse(tour.hardExpiresAt) - Date.parse(tour.createdAt),
    LIVE_GROUP_MAX_LIFETIME_MS,
  );
});

test("later stored expiry cannot extend the original 24-hour group lifetime", () => {
  const tour = createTour(2);
  const tamperedTour = {
    ...tour,
    hardExpiresAt: "2026-08-28T08:00:00.000Z",
  };

  const resolved = resolveLiveGroupTour(tamperedTour, "2026-08-27T08:00:00.000Z");

  assert.equal(resolved.hardExpiresAt, "2026-08-27T08:00:00.000Z");
  assert.equal(resolved.state, "expired");
  assert.equal(resolved.endedAt, "2026-08-27T08:00:00.000Z");
});

test("participant count can be entered and changed while active without extending expiry", () => {
  const tour = createTour();
  const first = updateLiveGroupParticipantCount(tour, 3, "2026-08-26T09:00:00.000Z");
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = updateLiveGroupParticipantCount(
    first.tour,
    4,
    "2026-08-26T10:30:00.000Z",
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;

  assert.equal(second.tour.participantCount, 4);
  assert.equal(second.tour.hardExpiresAt, tour.hardExpiresAt);
});

test("participant count stays a bounded positive integer", () => {
  const tour = createTour();

  for (const participantCount of [0, -1, 1.5, 501]) {
    const result = updateLiveGroupParticipantCount(
      tour,
      participantCount,
      "2026-08-26T09:00:00.000Z",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid-participants");
  }
});

test("manual close requires the final participant count", () => {
  const result = closeLiveGroupTour(createTour(), "2026-08-26T10:30:00.000Z");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "final-participants-required");
    assert.equal(result.tour.state, "active");
  }
});

test("manual close is the normal lifecycle and produces Field Session person-time", () => {
  const result = closeLiveGroupTour(createTour(3), "2026-08-26T10:30:00.000Z");

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.tour.state, "closed");
  assert.equal(result.tour.endedAt, "2026-08-26T10:30:00.000Z");
  assert.equal(result.tour.hardExpiresAt, "2026-08-27T08:00:00.000Z");
  assert.deepEqual(result.session, {
    mode: "distribution",
    startedAt: CREATED_AT,
    endedAt: "2026-08-26T10:30:00.000Z",
    participantCount: 3,
    metrics: {
      durationMinutes: 150,
      participantCount: 3,
      personMinutes: 450,
      affectedTaskCount: 0,
    },
  });
});

test("forgotten active tour becomes expired exactly at the original hard expiry", () => {
  const tour = createTour(2);
  const before = resolveLiveGroupTour(tour, "2026-08-27T07:59:59.999Z");
  assert.equal(before.state, "active");

  const expired = resolveLiveGroupTour(tour, "2026-08-27T08:00:00.000Z");
  assert.equal(expired.state, "expired");
  assert.equal(expired.endedAt, tour.hardExpiresAt);
  assert.equal(expired.hardExpiresAt, tour.hardExpiresAt);
});

test("manual close at or after hard expiry cannot turn expiry into a normal close", () => {
  const result = closeLiveGroupTour(createTour(2), "2026-08-27T08:00:00.000Z");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "not-active");
    assert.equal(result.tour.state, "expired");
  }
});

test("participant count cannot change after close or expiry", () => {
  const closed = closeLiveGroupTour(createTour(2), "2026-08-26T10:00:00.000Z");
  assert.equal(closed.ok, true);
  if (!closed.ok) return;

  const afterClose = updateLiveGroupParticipantCount(
    closed.tour,
    3,
    "2026-08-26T10:15:00.000Z",
  );
  assert.equal(afterClose.ok, false);
  if (!afterClose.ok) assert.equal(afterClose.reason, "not-active");

  const expired = resolveLiveGroupTour(createTour(2), "2026-08-27T08:00:00.000Z");
  const afterExpiry = updateLiveGroupParticipantCount(
    expired,
    3,
    "2026-08-27T08:15:00.000Z",
  );
  assert.equal(afterExpiry.ok, false);
  if (!afterExpiry.ok) assert.equal(afterExpiry.reason, "not-active");
});

test("tour creation rejects invalid identity, timestamps and initial participants", () => {
  assert.throws(
    () =>
      createLiveGroupTour({
        groupId: "<script>",
        mode: "distribution",
        createdAt: CREATED_AT,
      }),
    /invalid_live_group_id/u,
  );
  assert.throws(
    () =>
      createLiveGroupTour({
        groupId: "group_alpha",
        mode: "distribution",
        createdAt: "not-a-date",
      }),
    /invalid_live_group_created_at/u,
  );
  assert.throws(
    () =>
      createLiveGroupTour({
        groupId: "group_alpha",
        mode: "distribution",
        createdAt: CREATED_AT,
        participantCount: 0,
      }),
    /invalid_live_group_participants/u,
  );
});
