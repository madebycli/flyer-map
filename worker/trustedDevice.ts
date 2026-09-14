import { hashSecret, randomSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

export type TrustedDeviceSubjectKind = "campaign_admin" | "organization_account";
export type TrustedDeviceAssurance = "mfa" | "password";

export const TRUSTED_DEVICE_IDLE_SECONDS = 60 * 60 * 24 * 60;
export const TRUSTED_DEVICE_ABSOLUTE_SECONDS = 60 * 60 * 24 * 90;
export const TRUSTED_DEVICE_ROTATION_GRACE_SECONDS = 10;

type TrustedDeviceRow = {
  id: string;
  subject_kind: TrustedDeviceSubjectKind;
  subject_id: string;
  family_id: string;
  token_hash: string;
  assurance: string | null;
  created_at: string;
  last_used_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  replaced_by_id: string | null;
};

export type TrustedDeviceToken = {
  secret: string;
  familyId: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
};

export type TrustedDeviceConsumeResult =
  | { ok: true; subjectId: string; assurance: string | null; token: TrustedDeviceToken }
  | { ok: false; code: "invalid" | "expired" | "rotated" | "replayed" | "subject_invalid" | "schema_unavailable" };

export async function hasTrustedDeviceSchema(db: D1DatabaseLike) {
  try {
    const columns = await db.prepare("PRAGMA table_info(auth_trusted_devices)").all<{ name: string }>();
    return [
      "id",
      "subject_kind",
      "subject_id",
      "family_id",
      "token_hash",
      "created_at",
      "last_used_at",
      "idle_expires_at",
      "absolute_expires_at",
      "revoked_at",
      "replaced_by_id",
    ].every((name) => columns.results.some((column) => column.name === name));
  } catch {
    return false;
  }
}

function expiry(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export async function createTrustedDevice(
  db: D1DatabaseLike,
  input: { subjectKind: TrustedDeviceSubjectKind; subjectId: string; assurance?: TrustedDeviceAssurance | null; now?: Date },
): Promise<TrustedDeviceToken | null> {
  if (!(await hasTrustedDeviceSchema(db))) return null;
  const now = input.now ?? new Date();
  const secret = randomSecret();
  const tokenHash = await hashSecret(secret);
  const familyId = `trusted_family_${crypto.randomUUID()}`;
  const id = `trusted_device_${crypto.randomUUID()}`;
  const idleExpiresAt = expiry(now, TRUSTED_DEVICE_IDLE_SECONDS);
  const absoluteExpiresAt = expiry(now, TRUSTED_DEVICE_ABSOLUTE_SECONDS);
  const result = await db.batch([
    db.prepare(
      `INSERT INTO auth_trusted_devices
        (id, subject_kind, subject_id, family_id, token_hash, assurance,
         created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at, replaced_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      id,
      input.subjectKind,
      input.subjectId,
      familyId,
      tokenHash,
      input.assurance ?? null,
      now.toISOString(),
      now.toISOString(),
      idleExpiresAt,
      absoluteExpiresAt,
    ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) return null;
  return { secret, familyId, idleExpiresAt, absoluteExpiresAt };
}

async function rowBySecret(db: D1DatabaseLike, secret: string, subjectKind: TrustedDeviceSubjectKind) {
  if (!secret || secret.length > 256) return null;
  const tokenHash = await hashSecret(secret);
  return db.prepare(
    `SELECT id, subject_kind, subject_id, family_id, token_hash, assurance,
            created_at, last_used_at, idle_expires_at, absolute_expires_at,
            revoked_at, replaced_by_id
     FROM auth_trusted_devices
     WHERE token_hash = ? AND subject_kind = ?
     LIMIT 1`,
  ).bind(tokenHash, subjectKind).first<TrustedDeviceRow>();
}

async function revokeFamily(db: D1DatabaseLike, familyId: string, now: string) {
  await db.batch([
    db.prepare(
      `UPDATE auth_trusted_devices
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE family_id = ?`,
    ).bind(now, familyId),
  ]);
}

function withinRotationGrace(revokedAt: string, now: Date) {
  const revokedMs = Date.parse(revokedAt);
  return Number.isFinite(revokedMs) && now.getTime() - revokedMs >= 0 && now.getTime() - revokedMs <= TRUSTED_DEVICE_ROTATION_GRACE_SECONDS * 1000;
}

export async function consumeTrustedDevice(
  db: D1DatabaseLike,
  input: {
    subjectKind: TrustedDeviceSubjectKind;
    secret: string;
    now?: Date;
    validateSubject(subjectId: string, assurance: string | null): Promise<boolean>;
  },
): Promise<TrustedDeviceConsumeResult> {
  if (!(await hasTrustedDeviceSchema(db))) return { ok: false, code: "schema_unavailable" };
  const row = await rowBySecret(db, input.secret, input.subjectKind);
  if (!row) return { ok: false, code: "invalid" };
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  if (row.revoked_at) {
    if (row.replaced_by_id) {
      // Browser cookies are shared across tabs. A second tab can race the first
      // rotation with the same old token. During a very short grace interval we
      // reject that stale token without authenticating it and without revoking
      // the valid replacement. Outside the grace interval it is a real replay
      // signal and revokes the complete family.
      if (withinRotationGrace(row.revoked_at, now)) return { ok: false, code: "rotated" };
      await revokeFamily(db, row.family_id, nowIso);
      return { ok: false, code: "replayed" };
    }
    return { ok: false, code: "invalid" };
  }
  if (row.idle_expires_at <= nowIso || row.absolute_expires_at <= nowIso) {
    await revokeFamily(db, row.family_id, nowIso);
    return { ok: false, code: "expired" };
  }
  if (!(await input.validateSubject(row.subject_id, row.assurance))) {
    await revokeFamily(db, row.family_id, nowIso);
    return { ok: false, code: "subject_invalid" };
  }

  const replacementSecret = randomSecret();
  const replacementHash = await hashSecret(replacementSecret);
  const replacementId = `trusted_device_${crypto.randomUUID()}`;
  const idleExpiresAt = expiry(now, TRUSTED_DEVICE_IDLE_SECONDS);
  const boundedIdleExpiresAt = idleExpiresAt < row.absolute_expires_at ? idleExpiresAt : row.absolute_expires_at;
  const result = await db.batch([
    db.prepare(
      `UPDATE auth_trusted_devices
       SET revoked_at = ?, replaced_by_id = ?
       WHERE id = ? AND revoked_at IS NULL`,
    ).bind(nowIso, replacementId, row.id),
    db.prepare(
      `INSERT INTO auth_trusted_devices
        (id, subject_kind, subject_id, family_id, token_hash, assurance,
         created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at, replaced_by_id)
       SELECT ?, subject_kind, subject_id, family_id, ?, assurance,
              ?, ?, ?, absolute_expires_at, NULL, NULL
       FROM auth_trusted_devices
       WHERE id = ? AND replaced_by_id = ? AND revoked_at = ?`,
    ).bind(
      replacementId,
      replacementHash,
      nowIso,
      nowIso,
      boundedIdleExpiresAt,
      row.id,
      replacementId,
      nowIso,
    ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1 || (result[1]?.meta?.changes ?? 0) !== 1) {
    const current = await rowBySecret(db, input.secret, input.subjectKind);
    if (current?.revoked_at && current.replaced_by_id && withinRotationGrace(current.revoked_at, now)) {
      return { ok: false, code: "rotated" };
    }
    await revokeFamily(db, row.family_id, nowIso);
    return { ok: false, code: "replayed" };
  }

  return {
    ok: true,
    subjectId: row.subject_id,
    assurance: row.assurance,
    token: {
      secret: replacementSecret,
      familyId: row.family_id,
      idleExpiresAt: boundedIdleExpiresAt,
      absoluteExpiresAt: row.absolute_expires_at,
    },
  };
}

export async function revokeTrustedDeviceBySecret(
  db: D1DatabaseLike,
  subjectKind: TrustedDeviceSubjectKind,
  secret: string,
) {
  if (!(await hasTrustedDeviceSchema(db))) return;
  const row = await rowBySecret(db, secret, subjectKind);
  if (!row) return;
  await revokeFamily(db, row.family_id, new Date().toISOString());
}

export async function revokeTrustedDevicesForSubject(
  db: D1DatabaseLike,
  subjectKind: TrustedDeviceSubjectKind,
  subjectId: string,
) {
  if (!(await hasTrustedDeviceSchema(db))) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE auth_trusted_devices
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE subject_kind = ? AND subject_id = ?`,
    ).bind(now, subjectKind, subjectId),
  ]);
}
