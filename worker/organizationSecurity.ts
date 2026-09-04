import { cookieValue, hashSecret, randomSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  normalizeOrganizationUsername,
  validOrganizationPassword,
  type OrganizationCapability,
  type OrganizationMembershipRole,
} from "./organizationAuth.ts";

const ACCOUNT_SESSION_COOKIE = "__Host-vf_organization_session";
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const CHALLENGE_SECONDS = 60 * 5;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const FRESH_MFA_SECONDS = 10 * 60;
const INVITE_MAX_HOURS = 24 * 7;
const RESET_MAX_MINUTES = 60;
const DUMMY_SALT = new Uint8Array(PASSWORD_SALT_BYTES).fill(91);

export const ORGANIZATION_CAPABILITY_REGISTRY: readonly OrganizationCapability[] = [
  "organization.create",
  "organization.manage",
  "account.manage",
  "role.manage",
  "campaign.create",
  "campaign.manage",
  "campaign.delete",
  "team.cross_manage",
  "audit.read",
  "security.manage",
];

type CredentialRow = {
  id: string;
  disabled_at: string | null;
  algorithm: string | null;
  iterations: number | null;
  salt: string | null;
  verifier: string | null;
};

type InviteRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  role_kind: OrganizationMembershipRole;
  capabilities_json: string;
  expires_at: string;
};

type ResetRow = {
  id: string;
  organization_id: string;
  account_id: string;
  expires_at: string;
};

export type OrganizationSessionSummary = {
  id: string;
  assurance: "mfa" | "recovery";
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function fixedLengthEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const workerSalt = new Uint8Array(salt.byteLength);
  workerSalt.set(salt);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: workerSalt, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function passwordRecord(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const verifier = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    algorithm: "pbkdf2-sha256-v1" as const,
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToBase64Url(salt),
    verifier: bytesToBase64Url(verifier),
  };
}

async function credentialRow(db: D1DatabaseLike, accountId: string) {
  return db
    .prepare(
      `SELECT a.id, a.disabled_at, p.algorithm, p.iterations, p.salt, p.verifier
       FROM organization_accounts a
       LEFT JOIN organization_password_credentials p ON p.account_id = a.id
       WHERE a.id = ? LIMIT 1`,
    )
    .bind(accountId)
    .first<CredentialRow>();
}

async function passwordMatchesAccount(db: D1DatabaseLike, accountId: string, password: unknown) {
  const submitted = typeof password === "string" ? password : "";
  const row = await credentialRow(db, accountId);
  const salt = row?.salt ? base64UrlToBytes(row.salt) : null;
  const expected = row?.verifier ? base64UrlToBytes(row.verifier) : null;
  const iterations = row?.iterations === PASSWORD_ITERATIONS ? row.iterations : PASSWORD_ITERATIONS;
  const derived = await derivePassword(submitted, salt ?? DUMMY_SALT, iterations);
  return Boolean(
    row &&
      !row.disabled_at &&
      row.algorithm === "pbkdf2-sha256-v1" &&
      expected &&
      fixedLengthEqual(derived, expected),
  );
}

async function aesKey(value: string) {
  const raw = base64UrlToBytes(value);
  if (!raw || raw.byteLength !== 32) throw new Error("organization_totp_key_invalid");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptTotpSecret(secret: string, keyValue: string, accountId: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(keyValue);
  const aad = new TextEncoder().encode(`org-totp:${accountId}:v1`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let raw = "";
  for (const byte of bytes) raw += RECOVERY_ALPHABET[byte & 31];
  return raw.match(/.{1,4}/gu)?.join("-") ?? raw;
}

function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/gu, "");
}

async function recoveryCodeHash(accountId: string, code: string) {
  return hashSecret(`${accountId}:${normalizeRecoveryCode(code)}`);
}

async function recoveryBundle(accountId: string) {
  const codes = Array.from({ length: 10 }, () => randomRecoveryCode());
  const hashes = await Promise.all(codes.map((code) => recoveryCodeHash(accountId, code)));
  return { codes, hashes };
}

async function enrollmentBundle(accountId: string, username: string, totpKey: string) {
  const secret = bytesToBase32(crypto.getRandomValues(new Uint8Array(20)));
  const encrypted = await encryptTotpSecret(secret, totpKey, accountId);
  const recovery = await recoveryBundle(accountId);
  const challengeSecret = randomSecret();
  const challengeHash = await hashSecret(challengeSecret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_SECONDS * 1000).toISOString();
  const label = `Flyer Map:${username}`;
  return {
    secret,
    encrypted,
    recovery,
    challengeSecret,
    challengeHash,
    challengeId: `org_challenge_${crypto.randomUUID()}`,
    challengeCreatedAt: now.toISOString(),
    challengeExpiresAt: expiresAt,
    otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent("Flyer Map")}&algorithm=SHA1&digits=6&period=30`,
  };
}

export function parseOrganizationCapabilities(value: unknown) {
  if (!Array.isArray(value)) return null;
  const capabilities: OrganizationCapability[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ORGANIZATION_CAPABILITY_REGISTRY.includes(item as OrganizationCapability)) {
      return null;
    }
    if (!capabilities.includes(item as OrganizationCapability)) capabilities.push(item as OrganizationCapability);
  }
  return capabilities;
}

function parseStoredCapabilities(value: string) {
  try {
    return parseOrganizationCapabilities(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export async function hasFreshOrganizationMfa(
  db: D1DatabaseLike,
  request: Request,
  maxAgeSeconds = FRESH_MFA_SECONDS,
) {
  const secret = cookieValue(request, ACCOUNT_SESSION_COOKIE);
  if (!secret || secret.length > 256) return false;
  const hash = await hashSecret(secret);
  const now = Date.now();
  const cutoff = new Date(now - maxAgeSeconds * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT id FROM organization_account_sessions
       WHERE session_hash = ? AND assurance = 'mfa' AND revoked_at IS NULL
         AND expires_at > ? AND created_at >= ?
       LIMIT 1`,
    )
    .bind(hash, new Date(now).toISOString(), cutoff)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function createOrganizationInvite(
  db: D1DatabaseLike,
  input: {
    organizationId: string;
    actorAccountId: string;
    role: OrganizationMembershipRole;
    capabilities: OrganizationCapability[];
    expiresInHours?: number;
  },
) {
  const secret = randomSecret();
  const tokenHash = await hashSecret(secret);
  const now = new Date();
  const hours = Math.min(Math.max(Math.trunc(input.expiresInHours ?? 48), 1), INVITE_MAX_HOURS);
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  const id = `org_invite_${crypto.randomUUID()}`;
  const capabilities = input.role === "organizer" ? [] : input.capabilities;
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO organization_invites
          (id, organization_id, created_by_account_id, token_hash, role_kind, capabilities_json,
           created_at, expires_at, used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        id,
        input.organizationId,
        input.actorAccountId,
        tokenHash,
        input.role,
        JSON.stringify(capabilities),
        now.toISOString(),
        expiresAt,
      ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("organization_invite_create_failed");
  return { id, secret, expiresAt, role: input.role, capabilities };
}

export async function redeemOrganizationInvite(
  db: D1DatabaseLike,
  input: { inviteSecret: unknown; username: unknown; password: unknown; totpKey: string },
) {
  const secret = typeof input.inviteSecret === "string" && input.inviteSecret.length <= 256
    ? input.inviteSecret
    : "";
  const username = normalizeOrganizationUsername(input.username);
  if (!secret || !username || !validOrganizationPassword(input.password)) {
    return { ok: false as const, code: "invalid_invite_setup" };
  }
  const tokenHash = await hashSecret(secret);
  const now = new Date().toISOString();
  const invite = await db
    .prepare(
      `SELECT i.id, i.organization_id, o.name AS organization_name, i.role_kind,
              i.capabilities_json, i.expires_at
       FROM organization_invites i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<InviteRow>();
  if (!invite) return { ok: false as const, code: "invite_unavailable" };
  const capabilities = parseStoredCapabilities(invite.capabilities_json);
  if (!capabilities) return { ok: false as const, code: "invite_unavailable" };

  const accountId = `org_account_${crypto.randomUUID()}`;
  const membershipId = `org_membership_${crypto.randomUUID()}`;
  const password = await passwordRecord(input.password);
  const enrollment = await enrollmentBundle(accountId, username.display, input.totpKey);
  const statements = [
    db
      .prepare(
        `INSERT INTO organization_accounts
          (id, username, username_normalized, disabled_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .bind(accountId, username.display, username.normalized, now, now),
    db
      .prepare(
        `INSERT INTO organization_invite_claims (invite_id, account_id, claimed_at)
         VALUES (?, ?, ?)`,
      )
      .bind(invite.id, accountId, now),
    db
      .prepare(
        `INSERT INTO organization_password_credentials
          (account_id, algorithm, iterations, salt, verifier, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(accountId, password.algorithm, password.iterations, password.salt, password.verifier, now),
    db
      .prepare(
        `INSERT INTO organization_totp_credentials
          (account_id, secret_ciphertext, secret_nonce, key_version, verified_at, last_counter, updated_at)
         VALUES (?, ?, ?, 1, NULL, NULL, ?)`,
      )
      .bind(accountId, enrollment.encrypted.ciphertext, enrollment.encrypted.nonce, now),
    db
      .prepare(
        `INSERT INTO organization_memberships
          (id, organization_id, account_id, role_kind, role_template_id, capabilities_json,
           disabled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .bind(
        membershipId,
        invite.organization_id,
        accountId,
        invite.role_kind,
        JSON.stringify(invite.role_kind === "organizer" ? [] : capabilities),
        now,
        now,
      ),
    ...enrollment.recovery.hashes.map((codeHash) =>
      db
        .prepare(
          `INSERT INTO organization_recovery_codes
            (id, account_id, code_hash, created_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .bind(`org_recovery_${crypto.randomUUID()}`, accountId, codeHash, now),
    ),
    db
      .prepare(
        `INSERT INTO organization_login_challenges
          (id, account_id, challenge_hash, purpose, created_at, expires_at, used_at)
         VALUES (?, ?, ?, 'bootstrap', ?, ?, NULL)`,
      )
      .bind(
        enrollment.challengeId,
        accountId,
        enrollment.challengeHash,
        enrollment.challengeCreatedAt,
        enrollment.challengeExpiresAt,
      ),
    db
      .prepare(
        `UPDATE organization_invites SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now, invite.id, now),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'invite.redeem', 'membership', ?, ?, ?)`,
      )
      .bind(
        `org_audit_${crypto.randomUUID()}`,
        invite.organization_id,
        accountId,
        membershipId,
        JSON.stringify({ role: invite.role_kind }),
        now,
      ),
  ];
  try {
    const result = await db.batch(statements);
    const claimResult = result[1];
    const inviteUpdate = result[result.length - 2];
    if ((claimResult?.meta?.changes ?? 0) !== 1 || (inviteUpdate?.meta?.changes ?? 0) !== 1) {
      throw new Error("organization_invite_claim_failed");
    }
  } catch {
    return { ok: false as const, code: "invite_unavailable" };
  }
  return {
    ok: true as const,
    organization: { id: invite.organization_id, name: invite.organization_name },
    account: { id: accountId, username: username.display },
    membership: { id: membershipId, role: invite.role_kind },
    otpauthUri: enrollment.otpauthUri,
    recoveryCodes: enrollment.recovery.codes,
    challengeSecret: enrollment.challengeSecret,
    challengeExpiresAt: enrollment.challengeExpiresAt,
  };
}

export async function createOrganizationPasswordReset(
  db: D1DatabaseLike,
  input: { organizationId: string; targetAccountId: string; actorAccountId: string; expiresInMinutes?: number },
) {
  const target = await db
    .prepare(
      `SELECT m.id FROM organization_memberships m
       JOIN organization_accounts a ON a.id = m.account_id
       WHERE m.organization_id = ? AND m.account_id = ? AND m.disabled_at IS NULL AND a.disabled_at IS NULL
       LIMIT 1`,
    )
    .bind(input.organizationId, input.targetAccountId)
    .first<{ id: string }>();
  if (!target) return { ok: false as const, code: "account_not_found" };
  const secret = randomSecret();
  const tokenHash = await hashSecret(secret);
  const now = new Date();
  const minutes = Math.min(Math.max(Math.trunc(input.expiresInMinutes ?? 30), 5), RESET_MAX_MINUTES);
  const expiresAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const id = `org_password_reset_${crypto.randomUUID()}`;
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_password_resets
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE organization_id = ? AND account_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now.toISOString(), input.organizationId, input.targetAccountId),
    db
      .prepare(
        `INSERT INTO organization_password_resets
          (id, organization_id, account_id, created_by_account_id, token_hash,
           created_at, expires_at, used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        id,
        input.organizationId,
        input.targetAccountId,
        input.actorAccountId,
        tokenHash,
        now.toISOString(),
        expiresAt,
      ),
  ]);
  if ((result[1]?.meta?.changes ?? 0) !== 1) throw new Error("organization_password_reset_create_failed");
  return { ok: true as const, id, secret, expiresAt };
}

export async function redeemOrganizationPasswordReset(
  db: D1DatabaseLike,
  input: { resetSecret: unknown; password: unknown },
) {
  const secret = typeof input.resetSecret === "string" && input.resetSecret.length <= 256 ? input.resetSecret : "";
  if (!secret || !validOrganizationPassword(input.password)) {
    return { ok: false as const, code: "invalid_reset" };
  }
  const tokenHash = await hashSecret(secret);
  const now = new Date().toISOString();
  const reset = await db
    .prepare(
      `SELECT id, organization_id, account_id, expires_at
       FROM organization_password_resets
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<ResetRow>();
  if (!reset) return { ok: false as const, code: "reset_unavailable" };
  const password = await passwordRecord(input.password);
  try {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE organization_password_credentials
           SET algorithm = ?, iterations = ?, salt = ?, verifier = ?, updated_at = ?
           WHERE account_id = ?`,
        )
        .bind(password.algorithm, password.iterations, password.salt, password.verifier, now, reset.account_id),
      db
        .prepare("INSERT INTO organization_password_reset_claims (reset_id, claimed_at) VALUES (?, ?)")
        .bind(reset.id, now),
      db
        .prepare(
          `UPDATE organization_password_resets SET used_at = ?
           WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
        )
        .bind(now, reset.id, now),
      db
        .prepare(
          `UPDATE organization_account_sessions SET revoked_at = COALESCE(revoked_at, ?)
           WHERE account_id = ? AND revoked_at IS NULL`,
        )
        .bind(now, reset.account_id),
      db
        .prepare(
          `INSERT INTO organization_audit_events
            (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
           VALUES (?, ?, ?, 'account.password_reset_redeem', 'account', ?, '{}', ?)`,
        )
        .bind(
          `org_audit_${crypto.randomUUID()}`,
          reset.organization_id,
          reset.account_id,
          reset.account_id,
          now,
        ),
    ]);
    if (
      (result[0]?.meta?.changes ?? 0) !== 1 ||
      (result[1]?.meta?.changes ?? 0) !== 1 ||
      (result[2]?.meta?.changes ?? 0) !== 1
    ) {
      throw new Error("organization_password_reset_claim_failed");
    }
  } catch {
    return { ok: false as const, code: "reset_unavailable" };
  }
  return { ok: true as const };
}

export async function changeOrganizationPassword(
  db: D1DatabaseLike,
  input: { organizationId: string; accountId: string; currentPassword: unknown; nextPassword: unknown },
) {
  if (!validOrganizationPassword(input.nextPassword)) return { ok: false as const, code: "invalid_password" };
  if (!(await passwordMatchesAccount(db, input.accountId, input.currentPassword))) {
    return { ok: false as const, code: "invalid_credentials" };
  }
  const password = await passwordRecord(input.nextPassword);
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_password_credentials
         SET algorithm = ?, iterations = ?, salt = ?, verifier = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(password.algorithm, password.iterations, password.salt, password.verifier, now, input.accountId),
    db
      .prepare(
        `UPDATE organization_account_sessions SET revoked_at = COALESCE(revoked_at, ?)
         WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.accountId),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'account.password_change', 'account', ?, '{}', ?)`,
      )
      .bind(`org_audit_${crypto.randomUUID()}`, input.organizationId, input.accountId, input.accountId, now),
  ]);
  return (result[0]?.meta?.changes ?? 0) === 1
    ? { ok: true as const }
    : { ok: false as const, code: "account_not_found" };
}

export async function changeOrganizationUsername(
  db: D1DatabaseLike,
  input: { organizationId: string; accountId: string; currentPassword: unknown; username: unknown },
) {
  const username = normalizeOrganizationUsername(input.username);
  if (!username) return { ok: false as const, code: "invalid_username" };
  if (!(await passwordMatchesAccount(db, input.accountId, input.currentPassword))) {
    return { ok: false as const, code: "invalid_credentials" };
  }
  const now = new Date().toISOString();
  try {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE organization_accounts
           SET username = ?, username_normalized = ?, updated_at = ?
           WHERE id = ? AND disabled_at IS NULL`,
        )
        .bind(username.display, username.normalized, now, input.accountId),
      db
        .prepare(
          `INSERT INTO organization_audit_events
            (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
           VALUES (?, ?, ?, 'account.username_change', 'account', ?, '{}', ?)`,
        )
        .bind(`org_audit_${crypto.randomUUID()}`, input.organizationId, input.accountId, input.accountId, now),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1) return { ok: false as const, code: "account_not_found" };
  } catch {
    return { ok: false as const, code: "username_unavailable" };
  }
  return { ok: true as const, username: username.display };
}

export async function rotateOrganizationRecoveryCodes(
  db: D1DatabaseLike,
  input: { organizationId: string; accountId: string; currentPassword: unknown },
) {
  if (!(await passwordMatchesAccount(db, input.accountId, input.currentPassword))) {
    return { ok: false as const, code: "invalid_credentials" };
  }
  const bundle = await recoveryBundle(input.accountId);
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_recovery_codes SET used_at = COALESCE(used_at, ?)
         WHERE account_id = ? AND used_at IS NULL`,
      )
      .bind(now, input.accountId),
    ...bundle.hashes.map((codeHash) =>
      db
        .prepare(
          `INSERT INTO organization_recovery_codes
            (id, account_id, code_hash, created_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .bind(`org_recovery_${crypto.randomUUID()}`, input.accountId, codeHash, now),
    ),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'account.recovery_rotate', 'account', ?, '{}', ?)`,
      )
      .bind(`org_audit_${crypto.randomUUID()}`, input.organizationId, input.accountId, input.accountId, now),
  ]);
  if (result.some((item) => item.success === false)) throw new Error("organization_recovery_rotate_failed");
  return { ok: true as const, recoveryCodes: bundle.codes };
}

export async function restartOrganizationTotpEnrollment(
  db: D1DatabaseLike,
  input: {
    organizationId: string;
    accountId: string;
    username: string;
    currentPassword: unknown;
    totpKey: string;
  },
) {
  if (!(await passwordMatchesAccount(db, input.accountId, input.currentPassword))) {
    return { ok: false as const, code: "invalid_credentials" };
  }
  const enrollment = await enrollmentBundle(input.accountId, input.username, input.totpKey);
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `UPDATE organization_totp_credentials
         SET secret_ciphertext = ?, secret_nonce = ?, key_version = 1,
             verified_at = NULL, last_counter = NULL, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(enrollment.encrypted.ciphertext, enrollment.encrypted.nonce, now, input.accountId),
    db
      .prepare(
        `UPDATE organization_recovery_codes SET used_at = COALESCE(used_at, ?)
         WHERE account_id = ? AND used_at IS NULL`,
      )
      .bind(now, input.accountId),
    ...enrollment.recovery.hashes.map((codeHash) =>
      db
        .prepare(
          `INSERT INTO organization_recovery_codes
            (id, account_id, code_hash, created_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .bind(`org_recovery_${crypto.randomUUID()}`, input.accountId, codeHash, now),
    ),
    db
      .prepare(
        `UPDATE organization_login_challenges SET used_at = COALESCE(used_at, ?)
         WHERE account_id = ? AND used_at IS NULL`,
      )
      .bind(now, input.accountId),
    db
      .prepare(
        `INSERT INTO organization_login_challenges
          (id, account_id, challenge_hash, purpose, created_at, expires_at, used_at)
         VALUES (?, ?, ?, 'bootstrap', ?, ?, NULL)`,
      )
      .bind(
        enrollment.challengeId,
        input.accountId,
        enrollment.challengeHash,
        enrollment.challengeCreatedAt,
        enrollment.challengeExpiresAt,
      ),
    db
      .prepare(
        `UPDATE organization_account_sessions SET revoked_at = COALESCE(revoked_at, ?)
         WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.accountId),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'account.totp_restart', 'account', ?, '{}', ?)`,
      )
      .bind(`org_audit_${crypto.randomUUID()}`, input.organizationId, input.accountId, input.accountId, now),
  ];
  const result = await db.batch(statements);
  if ((result[0]?.meta?.changes ?? 0) !== 1) return { ok: false as const, code: "account_not_found" };
  return {
    ok: true as const,
    otpauthUri: enrollment.otpauthUri,
    recoveryCodes: enrollment.recovery.codes,
    challengeSecret: enrollment.challengeSecret,
    challengeExpiresAt: enrollment.challengeExpiresAt,
  };
}

async function currentSessionHash(request: Request) {
  const secret = cookieValue(request, ACCOUNT_SESSION_COOKIE);
  if (!secret || secret.length > 256) return null;
  return hashSecret(secret);
}

export async function listOrganizationAccountSessions(
  db: D1DatabaseLike,
  accountId: string,
  request: Request,
): Promise<OrganizationSessionSummary[]> {
  const currentHash = await currentSessionHash(request);
  const rows = await db
    .prepare(
      `SELECT id, session_hash, assurance, created_at, expires_at
       FROM organization_account_sessions
       WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC, id`,
    )
    .bind(accountId, new Date().toISOString())
    .all<{
      id: string;
      session_hash: string;
      assurance: "mfa" | "recovery";
      created_at: string;
      expires_at: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    assurance: row.assurance,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    current: Boolean(currentHash && fixedLengthEqual(
      new TextEncoder().encode(currentHash),
      new TextEncoder().encode(row.session_hash),
    )),
  }));
}

export async function revokeOrganizationAccountSessionById(
  db: D1DatabaseLike,
  accountId: string,
  sessionId: string,
) {
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_account_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(new Date().toISOString(), sessionId, accountId),
  ]);
  return (result[0]?.meta?.changes ?? 0) === 1;
}
