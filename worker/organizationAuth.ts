import { cookieValue, hashSecret, randomSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

const ACCOUNT_SESSION_COOKIE = "__Host-vf_organization_session";
const LOGIN_CHALLENGE_COOKIE = "__Host-vf_organization_login";
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const SESSION_SECONDS = 60 * 60 * 12;
const CHALLENGE_SECONDS = 60 * 5;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_SECONDS = 60 * 15;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/u;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DUMMY_SALT = new Uint8Array(PASSWORD_SALT_BYTES).fill(91);

export type OrganizationSessionAssurance = "mfa" | "recovery";
export type OrganizationMembershipRole = "organizer" | "admin";
export type OrganizationCapability =
  | "organization.create"
  | "organization.manage"
  | "account.manage"
  | "role.manage"
  | "campaign.create"
  | "campaign.manage"
  | "campaign.delete"
  | "team.cross_manage"
  | "audit.read"
  | "security.manage";

const ORGANIZATION_CAPABILITIES: readonly OrganizationCapability[] = [
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

export type OrganizationAccountSession = {
  accountId: string;
  username: string;
  assurance: OrganizationSessionAssurance;
  expiresAt: string;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  organizationName: string;
  accountId: string;
  role: OrganizationMembershipRole;
  capabilities: OrganizationCapability[];
};

type AccountCredentialRow = {
  id: string;
  username: string;
  disabled_at: string | null;
  algorithm: string | null;
  iterations: number | null;
  salt: string | null;
  verifier: string | null;
};

type ChallengeRow = {
  id: string;
  account_id: string;
  purpose: "bootstrap" | "login";
  expires_at: string;
  username: string;
  disabled_at: string | null;
  secret_ciphertext: string;
  secret_nonce: string;
  key_version: number;
  verified_at: string | null;
  last_counter: number | null;
};

type RecoveryChallengeRow = {
  id: string;
  account_id: string;
  purpose: "bootstrap" | "login";
  expires_at: string;
  username: string;
  disabled_at: string | null;
};

type SessionRow = {
  account_id: string;
  username: string;
  assurance: OrganizationSessionAssurance;
  expires_at: string;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  account_id: string;
  role_kind: OrganizationMembershipRole;
  capabilities_json: string;
  template_capabilities_json: string | null;
};

type TotpVerification = { counter: number } | null;

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

function base32ToBytes(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/u, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function fixedLengthEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function secretMatches(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([hashSecret(left), hashSecret(right)]);
  return fixedLengthEqual(new TextEncoder().encode(leftHash), new TextEncoder().encode(rightHash));
}

export function normalizeOrganizationUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const display = value.trim();
  if (!USERNAME_PATTERN.test(display)) return null;
  return { display, normalized: display.toLowerCase() };
}

export function validOrganizationPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

function validOrganizationName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
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
    algorithm: "pbkdf2-sha256-v1",
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToBase64Url(salt),
    verifier: bytesToBase64Url(verifier),
  };
}

async function passwordMatches(password: string, row: AccountCredentialRow | null) {
  const salt = row?.salt ? base64UrlToBytes(row.salt) : null;
  const expected = row?.verifier ? base64UrlToBytes(row.verifier) : null;
  const iterations = row?.iterations === PASSWORD_ITERATIONS ? row.iterations : PASSWORD_ITERATIONS;
  const derived = await derivePassword(password, salt ?? DUMMY_SALT, iterations);
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

async function decryptTotpSecret(row: ChallengeRow, keyValue: string) {
  if (row.key_version !== 1) throw new Error("organization_totp_key_version_unsupported");
  const nonce = base64UrlToBytes(row.secret_nonce);
  const ciphertext = base64UrlToBytes(row.secret_ciphertext);
  if (!nonce || !ciphertext) throw new Error("organization_totp_ciphertext_invalid");
  const key = await aesKey(keyValue);
  const aad = new TextEncoder().encode(`org-totp:${row.account_id}:v1`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

async function totpCodeForCounter(secretBase32: string, counter: number) {
  const secret = base32ToBytes(secretBase32);
  if (!secret) throw new Error("organization_totp_secret_invalid");
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const movingFactor = new ArrayBuffer(8);
  new DataView(movingFactor).setBigUint64(0, BigInt(counter), false);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, movingFactor));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function generateOrganizationTotpCode(secretBase32: string, nowMs = Date.now()) {
  return totpCodeForCounter(secretBase32, Math.floor(nowMs / 30_000));
}

async function verifyTotpCode(
  secretBase32: string,
  submitted: unknown,
  lastCounter: number | null,
  nowMs = Date.now(),
): Promise<TotpVerification> {
  if (typeof submitted !== "string" || !/^\d{6}$/u.test(submitted)) return null;
  const currentCounter = Math.floor(nowMs / 30_000);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    if (counter < 0 || (lastCounter !== null && counter <= lastCounter)) continue;
    const expected = await totpCodeForCounter(secretBase32, counter);
    if (fixedLengthEqual(new TextEncoder().encode(expected), new TextEncoder().encode(submitted))) {
      return { counter };
    }
  }
  return null;
}

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let raw = "";
  for (const byte of bytes) raw += RECOVERY_ALPHABET[byte & 31];
  return raw.match(/.{1,4}/gu)?.join("-") ?? raw;
}

function normalizeRecoveryCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/gu, "") : "";
}

async function recoveryCodeHash(accountId: string, code: string) {
  return hashSecret(`${accountId}:${normalizeRecoveryCode(code)}`);
}

function accountSessionCookie(secret: string) {
  return `${ACCOUNT_SESSION_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function loginChallengeCookie(secret: string) {
  return `${LOGIN_CHALLENGE_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${CHALLENGE_SECONDS}`;
}

export function clearOrganizationAccountSessionCookie() {
  return `${ACCOUNT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function clearOrganizationLoginChallengeCookie() {
  return `${LOGIN_CHALLENGE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function organizationAccountSessionCookie(secret: string) {
  return accountSessionCookie(secret);
}

export function organizationLoginChallengeCookie(secret: string) {
  return loginChallengeCookie(secret);
}

async function createAccountSession(
  db: D1DatabaseLike,
  accountId: string,
  assurance: OrganizationSessionAssurance,
) {
  const secret = randomSecret();
  const sessionHash = await hashSecret(secret);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO organization_account_sessions
          (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        `org_session_${crypto.randomUUID()}`,
        accountId,
        sessionHash,
        assurance,
        createdAt.toISOString(),
        expiresAt,
      ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("organization_session_create_failed");
  return { secret, expiresAt, assurance };
}

async function createChallengeData(accountId: string, purpose: "bootstrap" | "login") {
  const secret = randomSecret();
  const challengeHash = await hashSecret(secret);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CHALLENGE_SECONDS * 1000).toISOString();
  return {
    id: `org_challenge_${crypto.randomUUID()}`,
    accountId,
    purpose,
    secret,
    challengeHash,
    createdAt: createdAt.toISOString(),
    expiresAt,
  };
}

async function createLoginChallenge(
  db: D1DatabaseLike,
  accountId: string,
  purpose: "bootstrap" | "login",
) {
  const challenge = await createChallengeData(accountId, purpose);
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_login_challenges
         SET used_at = COALESCE(used_at, ?)
         WHERE account_id = ? AND used_at IS NULL`,
      )
      .bind(challenge.createdAt, accountId),
    db
      .prepare(
        `INSERT INTO organization_login_challenges
          (id, account_id, challenge_hash, purpose, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        challenge.id,
        challenge.accountId,
        challenge.challengeHash,
        challenge.purpose,
        challenge.createdAt,
        challenge.expiresAt,
      ),
  ]);
  if ((result[1]?.meta?.changes ?? 0) !== 1) throw new Error("organization_challenge_create_failed");
  return challenge;
}

async function throttleLocked(db: D1DatabaseLike, scope: string) {
  const now = new Date().toISOString();
  const row = await db
    .prepare("SELECT locked_until FROM organization_login_throttles WHERE scope = ? LIMIT 1")
    .bind(scope)
    .first<{ locked_until: string | null }>();
  return Boolean(row?.locked_until && row.locked_until > now);
}

async function recordLoginFailure(db: D1DatabaseLike, scope: string) {
  const now = new Date();
  const row = await db
    .prepare("SELECT failure_count, locked_until FROM organization_login_throttles WHERE scope = ? LIMIT 1")
    .bind(scope)
    .first<{ failure_count: number; locked_until: string | null }>();
  const wasExpired = Boolean(row?.locked_until && row.locked_until <= now.toISOString());
  const failureCount = wasExpired ? 1 : (row?.failure_count ?? 0) + 1;
  const lockedUntil = failureCount >= LOGIN_FAILURE_LIMIT
    ? new Date(now.getTime() + LOGIN_LOCK_SECONDS * 1000).toISOString()
    : null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO organization_login_throttles (scope, failure_count, locked_until, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           failure_count = excluded.failure_count,
           locked_until = excluded.locked_until,
           updated_at = excluded.updated_at`,
      )
      .bind(scope, failureCount, lockedUntil, now.toISOString()),
  ]);
}

async function clearLoginFailures(db: D1DatabaseLike, scope: string) {
  await db.batch([
    db.prepare("DELETE FROM organization_login_throttles WHERE scope = ?").bind(scope),
  ]);
}

export async function organizationBootstrapSecretMatches(submitted: string, configured: string) {
  if (!submitted || !configured) return false;
  return secretMatches(submitted, configured);
}

export async function bootstrapOrganization(
  db: D1DatabaseLike,
  input: {
    organizationName: unknown;
    username: unknown;
    password: unknown;
    totpKey: string;
  },
) {
  const username = normalizeOrganizationUsername(input.username);
  if (!validOrganizationName(input.organizationName) || !username || !validOrganizationPassword(input.password)) {
    return { ok: false as const, code: "invalid_setup" };
  }
  const organizationName = input.organizationName.trim();
  const now = new Date().toISOString();
  const organizationId = `org_${crypto.randomUUID()}`;
  const accountId = `org_account_${crypto.randomUUID()}`;
  const membershipId = `org_membership_${crypto.randomUUID()}`;
  const password = await passwordRecord(input.password);
  const totpSecret = bytesToBase32(crypto.getRandomValues(new Uint8Array(20)));
  const encryptedTotp = await encryptTotpSecret(totpSecret, input.totpKey, accountId);
  const recoveryCodes = Array.from({ length: 10 }, () => randomRecoveryCode());
  const recoveryHashes = await Promise.all(recoveryCodes.map((code) => recoveryCodeHash(accountId, code)));
  const challenge = await createChallengeData(accountId, "bootstrap");

  const statements = [
    db
      .prepare("INSERT INTO organization_bootstrap_state (singleton, completed_at) VALUES (1, ?)")
      .bind(now),
    db
      .prepare("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(organizationId, organizationName, now, now),
    db
      .prepare(
        `INSERT INTO organization_accounts
          (id, username, username_normalized, disabled_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .bind(accountId, username.display, username.normalized, now, now),
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
      .bind(accountId, encryptedTotp.ciphertext, encryptedTotp.nonce, now),
    db
      .prepare(
        `INSERT INTO organization_memberships
          (id, organization_id, account_id, role_kind, role_template_id, capabilities_json, disabled_at, created_at, updated_at)
         VALUES (?, ?, ?, 'organizer', NULL, '[]', NULL, ?, ?)`,
      )
      .bind(membershipId, organizationId, accountId, now, now),
    ...recoveryHashes.map((codeHash) =>
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
      .bind(challenge.id, accountId, challenge.challengeHash, challenge.createdAt, challenge.expiresAt),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'organization.bootstrap', 'organization', ?, '{}', ?)`,
      )
      .bind(`org_audit_${crypto.randomUUID()}`, organizationId, accountId, organizationId, now),
  ];

  try {
    const result = await db.batch(statements);
    if (result.some((item) => item.success === false)) throw new Error("organization_bootstrap_failed");
  } catch {
    return { ok: false as const, code: "bootstrap_unavailable" };
  }

  const label = `Flyer Map:${username.display}`;
  const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${totpSecret}&issuer=${encodeURIComponent("Flyer Map")}&algorithm=SHA1&digits=6&period=30`;
  return {
    ok: true as const,
    organization: { id: organizationId, name: organizationName },
    account: { id: accountId, username: username.display },
    otpauthUri,
    recoveryCodes,
    challengeSecret: challenge.secret,
    challengeExpiresAt: challenge.expiresAt,
  };
}

export async function beginOrganizationPasswordLogin(
  db: D1DatabaseLike,
  input: { username: unknown; password: unknown },
) {
  const username = normalizeOrganizationUsername(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  const normalized = username?.normalized ?? "invalid";
  const scope = `username:${normalized}`;
  if (await throttleLocked(db, scope)) return { ok: false as const, code: "throttled" };

  const row = username
    ? await db
        .prepare(
          `SELECT a.id, a.username, a.disabled_at,
                  p.algorithm, p.iterations, p.salt, p.verifier
           FROM organization_accounts a
           LEFT JOIN organization_password_credentials p ON p.account_id = a.id
           WHERE a.username_normalized = ?
           LIMIT 1`,
        )
        .bind(username.normalized)
        .first<AccountCredentialRow>()
    : null;

  if (!(await passwordMatches(password, row))) {
    await recordLoginFailure(db, scope);
    return { ok: false as const, code: "invalid_credentials" };
  }
  await clearLoginFailures(db, scope);
  const challenge = await createLoginChallenge(db, row!.id, "login");
  return {
    ok: true as const,
    challengeSecret: challenge.secret,
    challengeExpiresAt: challenge.expiresAt,
  };
}

async function challengeBySecret(db: D1DatabaseLike, challengeSecret: string, includeTotp: boolean) {
  const challengeHash = await hashSecret(challengeSecret);
  const now = new Date().toISOString();
  if (includeTotp) {
    return db
      .prepare(
        `SELECT c.id, c.account_id, c.purpose, c.expires_at,
                a.username, a.disabled_at,
                t.secret_ciphertext, t.secret_nonce, t.key_version, t.verified_at, t.last_counter
         FROM organization_login_challenges c
         JOIN organization_accounts a ON a.id = c.account_id
         JOIN organization_totp_credentials t ON t.account_id = c.account_id
         WHERE c.challenge_hash = ? AND c.used_at IS NULL AND c.expires_at > ?
         LIMIT 1`,
      )
      .bind(challengeHash, now)
      .first<ChallengeRow>();
  }
  return db
    .prepare(
      `SELECT c.id, c.account_id, c.purpose, c.expires_at, a.username, a.disabled_at
       FROM organization_login_challenges c
       JOIN organization_accounts a ON a.id = c.account_id
       WHERE c.challenge_hash = ? AND c.used_at IS NULL AND c.expires_at > ?
       LIMIT 1`,
    )
    .bind(challengeHash, now)
    .first<RecoveryChallengeRow>();
}

export async function completeOrganizationTotpLogin(
  db: D1DatabaseLike,
  input: { challengeSecret: string; code: unknown; totpKey: string; nowMs?: number },
) {
  if (!input.challengeSecret || input.challengeSecret.length > 256) {
    return { ok: false as const, code: "invalid_challenge" };
  }
  const row = await challengeBySecret(db, input.challengeSecret, true) as ChallengeRow | null;
  if (!row || row.disabled_at) return { ok: false as const, code: "invalid_challenge" };
  const secret = await decryptTotpSecret(row, input.totpKey);
  const verified = await verifyTotpCode(secret, input.code, row.last_counter, input.nowMs);
  if (!verified) return { ok: false as const, code: "invalid_factor" };
  const now = new Date(input.nowMs ?? Date.now()).toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_login_challenges
         SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(now, row.id, now),
    db
      .prepare(
        `UPDATE organization_totp_credentials
         SET verified_at = COALESCE(verified_at, ?), last_counter = ?, updated_at = ?
         WHERE account_id = ? AND (last_counter IS NULL OR last_counter < ?)`,
      )
      .bind(now, verified.counter, now, row.account_id, verified.counter),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1 || (result[1]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "invalid_factor" };
  }
  const session = await createAccountSession(db, row.account_id, "mfa");
  return {
    ok: true as const,
    account: { id: row.account_id, username: row.username },
    session,
  };
}

export async function completeOrganizationRecoveryLogin(
  db: D1DatabaseLike,
  input: { challengeSecret: string; recoveryCode: unknown },
) {
  if (!input.challengeSecret || input.challengeSecret.length > 256) {
    return { ok: false as const, code: "invalid_challenge" };
  }
  const row = await challengeBySecret(db, input.challengeSecret, false) as RecoveryChallengeRow | null;
  if (!row || row.disabled_at || row.purpose !== "login") {
    return { ok: false as const, code: "invalid_challenge" };
  }
  const normalizedCode = normalizeRecoveryCode(input.recoveryCode);
  if (!/^[A-Z2-9-]{20,40}$/u.test(normalizedCode)) return { ok: false as const, code: "invalid_factor" };
  const codeHash = await recoveryCodeHash(row.account_id, normalizedCode);
  const recovery = await db
    .prepare(
      `SELECT id FROM organization_recovery_codes
       WHERE account_id = ? AND code_hash = ? AND used_at IS NULL
       LIMIT 1`,
    )
    .bind(row.account_id, codeHash)
    .first<{ id: string }>();
  if (!recovery) return { ok: false as const, code: "invalid_factor" };
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare("UPDATE organization_login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .bind(now, row.id),
    db
      .prepare("UPDATE organization_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .bind(now, recovery.id),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1 || (result[1]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "invalid_factor" };
  }
  const session = await createAccountSession(db, row.account_id, "recovery");
  return {
    ok: true as const,
    account: { id: row.account_id, username: row.username },
    session,
  };
}

export async function resolveOrganizationAccountSession(
  db: D1DatabaseLike,
  request: Request,
): Promise<OrganizationAccountSession | null> {
  const secret = cookieValue(request, ACCOUNT_SESSION_COOKIE);
  if (!secret || secret.length > 256) return null;
  const sessionHash = await hashSecret(secret);
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT s.account_id, a.username, s.assurance, s.expires_at
       FROM organization_account_sessions s
       JOIN organization_accounts a ON a.id = s.account_id
       WHERE s.session_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
         AND a.disabled_at IS NULL
       LIMIT 1`,
    )
    .bind(sessionHash, now)
    .first<SessionRow>();
  return row
    ? {
        accountId: row.account_id,
        username: row.username,
        assurance: row.assurance,
        expiresAt: row.expires_at,
      }
    : null;
}

export async function revokeOrganizationAccountSession(db: D1DatabaseLike, request: Request) {
  const secret = cookieValue(request, ACCOUNT_SESSION_COOKIE);
  if (!secret || secret.length > 256) return;
  const sessionHash = await hashSecret(secret);
  await db.batch([
    db
      .prepare(
        `UPDATE organization_account_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE session_hash = ?`,
      )
      .bind(new Date().toISOString(), sessionHash),
  ]);
}

function parseCapabilities(value: string | null) {
  if (!value) return [] as OrganizationCapability[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OrganizationCapability =>
        typeof item === "string" && ORGANIZATION_CAPABILITIES.includes(item as OrganizationCapability),
    );
  } catch {
    return [];
  }
}

export async function listOrganizationMemberships(
  db: D1DatabaseLike,
  accountId: string,
): Promise<OrganizationMembership[]> {
  const rows = await db
    .prepare(
      `SELECT m.id, m.organization_id, o.name AS organization_name, m.account_id, m.role_kind,
              m.capabilities_json, r.capabilities_json AS template_capabilities_json
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN organization_role_templates r
         ON r.id = m.role_template_id AND r.organization_id = m.organization_id
       WHERE m.account_id = ? AND m.disabled_at IS NULL
       ORDER BY o.name, m.id`,
    )
    .bind(accountId)
    .all<MembershipRow>();
  return rows.results.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    accountId: row.account_id,
    role: row.role_kind,
    capabilities: row.role_kind === "organizer"
      ? [...ORGANIZATION_CAPABILITIES]
      : [...new Set([
          ...parseCapabilities(row.template_capabilities_json),
          ...parseCapabilities(row.capabilities_json),
        ])],
  }));
}

export async function resolveOrganizationMembership(
  db: D1DatabaseLike,
  accountId: string,
  organizationId: string,
) {
  const memberships = await listOrganizationMemberships(db, accountId);
  return memberships.find((membership) => membership.organizationId === organizationId) ?? null;
}

export async function requireOrganizationCapability(
  db: D1DatabaseLike,
  request: Request,
  organizationId: string,
  capability: OrganizationCapability,
) {
  const session = await resolveOrganizationAccountSession(db, request);
  if (!session) return { ok: false as const, code: "authentication_required" };
  if (session.assurance !== "mfa") return { ok: false as const, code: "mfa_required" };
  const membership = await resolveOrganizationMembership(db, session.accountId, organizationId);
  if (!membership || !membership.capabilities.includes(capability)) {
    return { ok: false as const, code: "forbidden" };
  }
  return { ok: true as const, session, membership };
}

export async function disableOrganizationMembership(
  db: D1DatabaseLike,
  organizationId: string,
  membershipId: string,
) {
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_memberships
         SET disabled_at = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND disabled_at IS NULL
           AND (
             role_kind <> 'organizer'
             OR EXISTS (
               SELECT 1 FROM organization_memberships other
               WHERE other.organization_id = ?
                 AND other.role_kind = 'organizer'
                 AND other.disabled_at IS NULL
                 AND other.id <> organization_memberships.id
             )
           )`,
      )
      .bind(now, now, membershipId, organizationId, organizationId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) === 1) return "disabled" as const;
  const target = await db
    .prepare(
      `SELECT role_kind, disabled_at FROM organization_memberships
       WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(membershipId, organizationId)
    .first<{ role_kind: OrganizationMembershipRole; disabled_at: string | null }>();
  if (!target || target.disabled_at) return "not_found" as const;
  return target.role_kind === "organizer" ? "last_organizer" as const : "not_found" as const;
}
