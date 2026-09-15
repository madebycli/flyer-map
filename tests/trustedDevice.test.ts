import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrustedDevice,
  consumeTrustedDevice,
  revokeTrustedDevicesForSubject,
  TRUSTED_DEVICE_ABSOLUTE_SECONDS,
  TRUSTED_DEVICE_IDLE_SECONDS,
  TRUSTED_DEVICE_ROTATION_GRACE_SECONDS,
} from "../worker/trustedDevice.ts";
import { NetworkD1 } from "./helpers/networkD1.ts";

const start = new Date("2026-09-14T18:00:00.000Z");
const later = (seconds: number) => new Date(start.getTime() + seconds * 1000);

test("trusted device rotates on use and replay revokes the whole family", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  const first = await createTrustedDevice(db, {
    subjectKind: "organization_account",
    subjectId: "org_account_a",
    assurance: "mfa",
    now: start,
  });
  assert.ok(first);

  const rotated = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: first.secret,
    now: later(60),
    validateSubject: async (subjectId, assurance) => subjectId === "org_account_a" && assurance === "mfa",
  });
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  assert.notEqual(rotated.token.secret, first.secret);
  assert.equal(rotated.token.familyId, first.familyId);

  const replay = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: first.secret,
    now: later(120),
    validateSubject: async () => true,
  });
  assert.deepEqual(replay, { ok: false, code: "replayed" });

  const familyAfterReplay = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: rotated.token.secret,
    now: later(180),
    validateSubject: async () => true,
  });
  assert.deepEqual(familyAfterReplay, { ok: false, code: "invalid" });
});

test("a concurrent old-token retry is rejected without revoking the fresh replacement", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  const first = await createTrustedDevice(db, {
    subjectKind: "organization_account",
    subjectId: "org_account_parallel",
    assurance: "mfa",
    now: start,
  });
  assert.ok(first);

  const rotated = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: first.secret,
    now: later(5),
    validateSubject: async () => true,
  });
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;

  const concurrentRetry = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: first.secret,
    now: later(5 + Math.max(1, TRUSTED_DEVICE_ROTATION_GRACE_SECONDS - 1)),
    validateSubject: async () => true,
  });
  assert.deepEqual(concurrentRetry, { ok: false, code: "rotated" });

  const replacementStillWorks = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: rotated.token.secret,
    now: later(5 + TRUSTED_DEVICE_ROTATION_GRACE_SECONDS),
    validateSubject: async () => true,
  });
  assert.equal(replacementStillWorks.ok, true, "benign cross-tab overlap must not revoke the replacement family");
});

test("trusted device enforces idle expiry and absolute family lifetime", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());

  const idle = await createTrustedDevice(db, {
    subjectKind: "campaign_admin",
    subjectId: "admin_a",
    assurance: "password",
    now: start,
  });
  assert.ok(idle);
  const idleExpired = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: idle.secret,
    now: later(TRUSTED_DEVICE_IDLE_SECONDS + 1),
    validateSubject: async () => true,
  });
  assert.deepEqual(idleExpired, { ok: false, code: "expired" });

  const absolute = await createTrustedDevice(db, {
    subjectKind: "campaign_admin",
    subjectId: "admin_b",
    assurance: "password",
    now: start,
  });
  assert.ok(absolute);
  const nearIdle = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: absolute.secret,
    now: later(TRUSTED_DEVICE_IDLE_SECONDS - 60),
    validateSubject: async () => true,
  });
  assert.equal(nearIdle.ok, true);
  if (!nearIdle.ok) return;
  assert.equal(nearIdle.token.absoluteExpiresAt, absolute.absoluteExpiresAt);

  const nearAbsolute = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: nearIdle.token.secret,
    now: later(TRUSTED_DEVICE_ABSOLUTE_SECONDS - 60),
    validateSubject: async () => true,
  });
  assert.equal(nearAbsolute.ok, true);
  if (!nearAbsolute.ok) return;
  assert.equal(nearAbsolute.token.idleExpiresAt, absolute.absoluteExpiresAt, "sliding idle expiry must never exceed the family absolute lifetime");

  const absoluteExpired = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: nearAbsolute.token.secret,
    now: later(TRUSTED_DEVICE_ABSOLUTE_SECONDS + 1),
    validateSubject: async () => true,
  });
  assert.deepEqual(absoluteExpired, { ok: false, code: "expired" });
});

test("subject invalidation and explicit subject revocation disable trusted devices", async (t) => {
  const db = new NetworkD1(true, true);
  t.after(() => db.sqlite.close());
  const invalidated = await createTrustedDevice(db, {
    subjectKind: "organization_account",
    subjectId: "org_account_disabled",
    assurance: "mfa",
    now: start,
  });
  assert.ok(invalidated);
  const invalid = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret: invalidated.secret,
    now: later(10),
    validateSubject: async () => false,
  });
  assert.deepEqual(invalid, { ok: false, code: "subject_invalid" });

  const revoked = await createTrustedDevice(db, {
    subjectKind: "campaign_admin",
    subjectId: "admin_revoked",
    assurance: "password",
    now: start,
  });
  assert.ok(revoked);
  await revokeTrustedDevicesForSubject(db, "campaign_admin", "admin_revoked");
  const afterRevoke = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret: revoked.secret,
    now: later(10),
    validateSubject: async () => true,
  });
  assert.deepEqual(afterRevoke, { ok: false, code: "invalid" });
});
