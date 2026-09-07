import {
  hashSecret,
  randomSecret,
  type AccessContext,
} from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

const ADMIN_ACCOUNT_COOKIE = "vf_admin_account_session";
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const SETUP_INVITE_SECONDS = 60 * 60 * 24;
const PASSWORD_RESET_SECONDS = 60 * 60 * 24;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_SECONDS = 60 * 15;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/u;
const DUMMY_SALT = new Uint8Array(PASSWORD_SALT_BYTES).fill(91);

type AdminAccountRow = {
  id: string;
  campaign_id: string;
  grant_id: string;
  username: string;
  username_normalized: string;
  password_algorithm: string;
  password_iterations: number;
  password_salt: string;
  password_hash: string;
  disabled_at: string | null;
  grant_revoked_at: string | null;
};

type SetupInviteRow = {
  id: string;
  campaign_id: string;
  expires_at: string;
  used_at: string | null;
};

type PasswordResetInviteRow = {
  id: string;
  campaign_id: string;
  account_id: string;
  expires_at: string;
  used_at: string | null;
};

type LoginThrottleRow = {
  failure_count: number;
  locked_until: string | null;
};

export type CampaignAdminAccountSummary = {
  id: string;
  campaignId: string;
  username: string;
  createdAt: string;
  disabledAt: string | null;
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

function fixedLengthEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function normalizeCampaignAdminUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const display = value.trim();
  if (!USERNAME_PATTERN.test(display)) return null;
  return { display, normalized: display.toLowerCase() };
}

export function validCampaignAdminPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  // Make a fresh ArrayBuffer-backed copy for the current TypeScript WebCrypto
  // definitions. The source may be typed as ArrayBufferLike, while Workers
  // accepts this byte sequence as the PBKDF2 salt.
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

async function passwordMatches(password: string, row: AdminAccountRow | null) {
  const salt = row ? base64UrlToBytes(row.password_salt) : null;
  const expected = row ? base64UrlToBytes(row.password_hash) : null;
  const iterations = row?.password_iterations === PASSWORD_ITERATIONS
    ? row.password_iterations
    : PASSWORD_ITERATIONS;
  const derived = await derivePassword(password, salt ?? DUMMY_SALT, iterations);
  return Boolean(
    row &&
      row.password_algorithm === "pbkdf2-sha256-v1" &&
      expected &&
      fixedLengthEqual(derived, expected),
  );
}

function cookieValue(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rawValue] = part.trim().split("=");
    if (name === ADMIN_ACCOUNT_COOKIE) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function adminAccountSessionCookie(secret: string) {
  return `${ADMIN_ACCOUNT_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_SECONDS}`;
}

export function clearAdminAccountSessionCookie() {
  return `${ADMIN_ACCOUNT_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hasCampaignAdminAuthSchema(db: D1DatabaseLike) {
  try {
    const [accounts, sessions, invites, throttles] = await Promise.all([
      db.prepare("PRAGMA table_info(campaign_admin_accounts)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(campaign_admin_sessions)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(campaign_admin_setup_invites)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(campaign_admin_login_throttles)").all<{ name: string }>(),
    ]);
    return (
      ["id", "campaign_id", "grant_id", "username", "username_normalized", "password_hash", "disabled_at"].every(
        (column) => accounts.results.some((item) => item.name === column),
      ) &&
      ["id", "account_id", "session_hash", "expires_at"].every(
        (column) => sessions.results.some((item) => item.name === column),
      ) &&
      ["id", "campaign_id", "token_hash", "expires_at", "used_at"].every(
        (column) => invites.results.some((item) => item.name === column),
      ) &&
      ["scope", "failure_count", "locked_until"].every(
        (column) => throttles.results.some((item) => item.name === column),
      )
    );
  } catch {
    return false;
  }
}

export async function hasCampaignAdminPasswordResetSchema(db: D1DatabaseLike) {
  try {
    const resets = await db
      .prepare("PRAGMA table_info(campaign_admin_password_reset_invites)")
      .all<{ name: string }>();
    return ["id", "campaign_id", "account_id", "token_hash", "expires_at", "used_at"].every(
      (column) => resets.results.some((item) => item.name === column),
    );
  } catch {
    return false;
  }
}

export async function resolveCampaignAdminAccountAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId?: string,
): Promise<AccessContext | null> {
  const secret = cookieValue(request);
  if (!secret || secret.length > 256) return null;
  try {
    const sessionHash = await hashSecret(secret);
    const now = new Date().toISOString();
    const row = await db
      .prepare(
        `SELECT a.id, a.campaign_id, a.grant_id, a.username
         FROM campaign_admin_sessions s
         JOIN campaign_admin_accounts a ON a.id = s.account_id AND a.campaign_id = s.campaign_id
         JOIN campaign_access_grants g ON g.id = a.grant_id AND g.campaign_id = a.campaign_id
         WHERE s.session_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
           AND a.disabled_at IS NULL AND g.revoked_at IS NULL
           AND (? IS NULL OR a.campaign_id = ?)
         LIMIT 1`,
      )
      .bind(sessionHash, now, campaignId ?? null, campaignId ?? null)
      .first<{ id: string; campaign_id: string; grant_id: string; username: string }>();
    if (!row) return null;
    return {
      grantId: row.grant_id,
      campaignId: row.campaign_id,
      role: "admin",
      teamId: null,
      label: row.username,
      groupId: null,
      membershipId: null,
    };
  } catch {
    return null;
  }
}

async function createAccountSession(db: D1DatabaseLike, account: AdminAccountRow) {
  const sessionSecret = randomSecret();
  const sessionHash = await hashSecret(sessionSecret);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ADMIN_SESSION_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_admin_sessions
          (id, campaign_id, account_id, session_hash, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        `admin_session_${crypto.randomUUID()}`,
        account.campaign_id,
        account.id,
        sessionHash,
        createdAt.toISOString(),
        expiresAt,
      ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("admin_session_create_failed");
  return { sessionSecret, expiresAt };
}

export async function revokeCurrentCampaignAdminAccountSession(
  db: D1DatabaseLike,
  request: Request,
) {
  const secret = cookieValue(request);
  if (!secret) return;
  try {
    const hash = await hashSecret(secret);
    await db.batch([
      db
        .prepare("UPDATE campaign_admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE session_hash = ?")
        .bind(new Date().toISOString(), hash),
    ]);
  } catch {
    // The additive migration may intentionally still be pending.
  }
}

export async function createCampaignAdminSetupInvite(
  db: D1DatabaseLike,
  campaignId: string,
) {
  const token = randomSecret();
  const tokenHash = await hashSecret(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SETUP_INVITE_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_admin_setup_invites
          (id, campaign_id, token_hash, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .bind(`admin_setup_${crypto.randomUUID()}`, campaignId, tokenHash, createdAt.toISOString(), expiresAt),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("admin_setup_invite_create_failed");
  return { token, expiresAt };
}

async function accountById(
  db: D1DatabaseLike,
  campaignId: string,
  accountId: string,
) {
  return db
    .prepare(
      `SELECT a.id, a.campaign_id, a.grant_id, a.username, a.username_normalized,
              a.password_algorithm, a.password_iterations, a.password_salt, a.password_hash,
              a.disabled_at, g.revoked_at AS grant_revoked_at
       FROM campaign_admin_accounts a
       JOIN campaign_access_grants g ON g.id = a.grant_id AND g.campaign_id = a.campaign_id
       WHERE a.id = ? AND a.campaign_id = ? LIMIT 1`,
    )
    .bind(accountId, campaignId)
    .first<AdminAccountRow>();
}

async function accountByUsername(
  db: D1DatabaseLike,
  campaignId: string,
  normalizedUsername: string,
) {
  return db
    .prepare(
      `SELECT a.id, a.campaign_id, a.grant_id, a.username, a.username_normalized,
              a.password_algorithm, a.password_iterations, a.password_salt, a.password_hash,
              a.disabled_at, g.revoked_at AS grant_revoked_at
       FROM campaign_admin_accounts a
       JOIN campaign_access_grants g ON g.id = a.grant_id AND g.campaign_id = a.campaign_id
       WHERE a.campaign_id = ? AND a.username_normalized = ? LIMIT 1`,
    )
    .bind(campaignId, normalizedUsername)
    .first<AdminAccountRow>();
}

export async function renameCampaignAdminAccount(
  db: D1DatabaseLike,
  campaignId: string,
  accountId: string,
  usernameValue: unknown,
) {
  const username = normalizeCampaignAdminUsername(usernameValue);
  if (!username) return { ok: false as const, code: "invalid_username" };
  const account = await accountById(db, campaignId, accountId);
  if (!account) return { ok: false as const, code: "account_not_found" };
  const existing = await accountByUsername(db, campaignId, username.normalized);
  if (existing && existing.id !== accountId) return { ok: false as const, code: "username_unavailable" };
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaign_admin_accounts
         SET username = ?, username_normalized = ?
         WHERE id = ? AND campaign_id = ?`,
      )
      .bind(username.display, username.normalized, accountId, campaignId),
    db
      .prepare(
        `UPDATE campaign_access_grants
         SET label = ?
         WHERE id = ? AND campaign_id = ?`,
      )
      .bind(`Admin-Konto: ${username.display}`, account.grant_id, campaignId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1 || (result[1]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "account_not_found" };
  }
  return { ok: true as const, username: username.display };
}

export async function createCampaignAdminPasswordResetInvite(
  db: D1DatabaseLike,
  campaignId: string,
  accountId: string,
) {
  const account = await accountById(db, campaignId, accountId);
  if (!account || account.disabled_at || account.grant_revoked_at) return null;
  const token = randomSecret();
  const tokenHash = await hashSecret(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PASSWORD_RESET_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaign_admin_password_reset_invites
         SET used_at = COALESCE(used_at, ?)
         WHERE campaign_id = ? AND account_id = ? AND used_at IS NULL`,
      )
      .bind(createdAt.toISOString(), campaignId, accountId),
    db
      .prepare(
        `INSERT INTO campaign_admin_password_reset_invites
          (id, campaign_id, account_id, token_hash, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        `admin_password_reset_${crypto.randomUUID()}`,
        campaignId,
        accountId,
        tokenHash,
        createdAt.toISOString(),
        expiresAt,
      ),
  ]);
  if ((result[1]?.meta?.changes ?? 0) !== 1) throw new Error("admin_password_reset_invite_create_failed");
  return { token, expiresAt, username: account.username };
}

export async function completeCampaignAdminSetup(
  db: D1DatabaseLike,
  input: { campaignId: string; token: string; username: unknown; password: unknown },
) {
  const username = normalizeCampaignAdminUsername(input.username);
  if (!username || !validCampaignAdminPassword(input.password) || input.token.length < 32 || input.token.length > 256) {
    return { ok: false as const, code: "invalid_setup" };
  }
  const tokenHash = await hashSecret(input.token);
  const now = new Date().toISOString();
  const invite = await db
    .prepare(
      `SELECT id, campaign_id, expires_at, used_at
       FROM campaign_admin_setup_invites
       WHERE token_hash = ? AND campaign_id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`,
    )
    .bind(tokenHash, input.campaignId, now)
    .first<SetupInviteRow>();
  if (!invite) return { ok: false as const, code: "setup_link_invalid" };
  if (await accountByUsername(db, input.campaignId, username.normalized)) {
    return { ok: false as const, code: "username_unavailable" };
  }
  const password = await passwordRecord(input.password);
  const accountId = `admin_account_${crypto.randomUUID()}`;
  const grantId = `grant_${crypto.randomUUID()}`;
  const grantTokenHash = await hashSecret(randomSecret());
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_access_grants
          (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
         VALUES (?, ?, 'admin', NULL, ?, ?, ?, NULL)`,
      )
      .bind(grantId, input.campaignId, grantTokenHash, `Admin-Konto: ${username.display}`, now),
    db
      .prepare(
        `INSERT INTO campaign_admin_accounts
          (id, campaign_id, grant_id, username, username_normalized, password_algorithm,
           password_iterations, password_salt, password_hash, created_at, disabled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        accountId,
        input.campaignId,
        grantId,
        username.display,
        username.normalized,
        password.algorithm,
        password.iterations,
        password.salt,
        password.verifier,
        now,
      ),
    db
      .prepare(
        "UPDATE campaign_admin_setup_invites SET used_at = ? WHERE id = ? AND campaign_id = ? AND used_at IS NULL",
      )
      .bind(now, invite.id, input.campaignId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1 || (result[1]?.meta?.changes ?? 0) !== 1 || (result[2]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "setup_link_invalid" };
  }
  const account: AdminAccountRow = {
    id: accountId,
    campaign_id: input.campaignId,
    grant_id: grantId,
    username: username.display,
    username_normalized: username.normalized,
    password_algorithm: password.algorithm,
    password_iterations: password.iterations,
    password_salt: password.salt,
    password_hash: password.verifier,
    disabled_at: null,
    grant_revoked_at: null,
  };
  const session = await createAccountSession(db, account);
  return {
    ok: true as const,
    access: {
      grantId,
      campaignId: input.campaignId,
      role: "admin" as const,
      teamId: null,
      label: username.display,
      groupId: null,
      membershipId: null,
    },
    session,
  };
}

async function lockedOut(db: D1DatabaseLike, scope: string, now: string) {
  const row = await db
    .prepare("SELECT failure_count, locked_until FROM campaign_admin_login_throttles WHERE scope = ? LIMIT 1")
    .bind(scope)
    .first<LoginThrottleRow>();
  return Boolean(row?.locked_until && row.locked_until > now);
}

async function recordLoginFailure(db: D1DatabaseLike, scope: string, now: string) {
  const lockedUntil = new Date(new Date(now).getTime() + LOGIN_LOCK_SECONDS * 1000).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_admin_login_throttles
          (scope, failure_count, locked_until, updated_at)
         VALUES (?, 1, NULL, ?)
         ON CONFLICT(scope) DO UPDATE SET
           failure_count = CASE
             WHEN campaign_admin_login_throttles.locked_until IS NOT NULL
              AND campaign_admin_login_throttles.locked_until <= excluded.updated_at THEN 1
             WHEN campaign_admin_login_throttles.failure_count < ? THEN campaign_admin_login_throttles.failure_count + 1
             ELSE campaign_admin_login_throttles.failure_count
           END,
           locked_until = CASE
             WHEN campaign_admin_login_throttles.locked_until IS NOT NULL
              AND campaign_admin_login_throttles.locked_until > excluded.updated_at THEN campaign_admin_login_throttles.locked_until
             WHEN campaign_admin_login_throttles.failure_count + 1 >= ? THEN ?
             ELSE NULL
           END,
           updated_at = excluded.updated_at`,
      )
      .bind(scope, now, LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_LIMIT, lockedUntil),
  ]);
}

export async function loginCampaignAdminAccount(
  db: D1DatabaseLike,
  input: { campaignId: string; username: unknown; password: unknown },
) {
  const username = normalizeCampaignAdminUsername(input.username);
  const password = typeof input.password === "string" && input.password.length <= 256 ? input.password : "";
  const scope = `${input.campaignId}:${username?.normalized ?? "invalid"}`;
  const now = new Date().toISOString();
  const account = username ? await accountByUsername(db, input.campaignId, username.normalized) : null;
  const isLocked = await lockedOut(db, scope, now);
  const verified = await passwordMatches(password, isLocked ? null : account);
  if (!account || account.disabled_at || account.grant_revoked_at || isLocked || !verified) {
    await recordLoginFailure(db, scope, now);
    return { ok: false as const };
  }
  await db.batch([
    db.prepare("DELETE FROM campaign_admin_login_throttles WHERE scope = ?").bind(scope),
  ]);
  const session = await createAccountSession(db, account);
  return {
    ok: true as const,
    access: {
      grantId: account.grant_id,
      campaignId: account.campaign_id,
      role: "admin" as const,
      teamId: null,
      label: account.username,
      groupId: null,
      membershipId: null,
    },
    session,
  };
}

export async function completeCampaignAdminPasswordReset(
  db: D1DatabaseLike,
  input: { campaignId: string; token: string; password: unknown },
) {
  if (!validCampaignAdminPassword(input.password) || input.token.length < 32 || input.token.length > 256) {
    return { ok: false as const, code: "invalid_reset" };
  }
  const tokenHash = await hashSecret(input.token);
  const now = new Date().toISOString();
  const invite = await db
    .prepare(
      `SELECT id, campaign_id, account_id, expires_at, used_at
       FROM campaign_admin_password_reset_invites
       WHERE token_hash = ? AND campaign_id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`,
    )
    .bind(tokenHash, input.campaignId, now)
    .first<PasswordResetInviteRow>();
  if (!invite) return { ok: false as const, code: "reset_link_invalid" };
  const account = await accountById(db, input.campaignId, invite.account_id);
  if (!account || account.disabled_at || account.grant_revoked_at) {
    return { ok: false as const, code: "reset_link_invalid" };
  }
  const password = await passwordRecord(input.password);
  const claim = await db.batch([
    db
      .prepare(
        `UPDATE campaign_admin_password_reset_invites
         SET used_at = ?
         WHERE id = ? AND campaign_id = ? AND account_id = ?
           AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(now, invite.id, input.campaignId, account.id, now),
  ]);
  if ((claim[0]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "reset_link_invalid" };
  }
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaign_admin_accounts
         SET password_algorithm = ?, password_iterations = ?, password_salt = ?, password_hash = ?
         WHERE id = ? AND campaign_id = ? AND disabled_at IS NULL`,
      )
      .bind(
        password.algorithm,
        password.iterations,
        password.salt,
        password.verifier,
        account.id,
        input.campaignId,
      ),
    db
      .prepare(
        `UPDATE campaign_admin_password_reset_invites
         SET used_at = COALESCE(used_at, ?)
         WHERE campaign_id = ? AND account_id = ? AND id <> ? AND used_at IS NULL`,
      )
      .bind(now, input.campaignId, account.id, invite.id),
    db
      .prepare(
        `UPDATE campaign_admin_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE account_id = ? AND campaign_id = ?`,
      )
      .bind(now, account.id, input.campaignId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, code: "reset_link_invalid" };
  }
  const session = await createAccountSession(db, account);
  return {
    ok: true as const,
    access: {
      grantId: account.grant_id,
      campaignId: account.campaign_id,
      role: "admin" as const,
      teamId: null,
      label: account.username,
      groupId: null,
      membershipId: null,
    },
    session,
  };
}

export async function listCampaignAdminAccounts(db: D1DatabaseLike, campaignId: string) {
  const result = await db
    .prepare(
      `SELECT id, campaign_id, username, created_at, disabled_at
       FROM campaign_admin_accounts WHERE campaign_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(campaignId)
    .all<{
      id: string;
      campaign_id: string;
      username: string;
      created_at: string;
      disabled_at: string | null;
    }>();
  return result.results.map((row): CampaignAdminAccountSummary => ({
    id: row.id,
    campaignId: row.campaign_id,
    username: row.username,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  }));
}

export async function disableCampaignAdminAccount(
  db: D1DatabaseLike,
  campaignId: string,
  accountId: string,
) {
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaign_admin_accounts
         SET disabled_at = ?
         WHERE id = ? AND campaign_id = ? AND disabled_at IS NULL
           AND (
             SELECT COUNT(*) FROM campaign_admin_accounts
             WHERE campaign_id = ? AND disabled_at IS NULL
           ) > 1`,
      )
      .bind(now, accountId, campaignId, campaignId),
    db
      .prepare(
        `UPDATE campaign_admin_sessions
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE account_id = ? AND campaign_id = ?
           AND EXISTS (
             SELECT 1 FROM campaign_admin_accounts
             WHERE id = ? AND campaign_id = ? AND disabled_at IS NOT NULL
           )`,
      )
      .bind(now, accountId, campaignId, accountId, campaignId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) === 1) return "disabled" as const;
  const account = await accountById(db, campaignId, accountId);
  if (!account) return "not_found" as const;
  if (account.disabled_at) return "disabled" as const;
  return "last_account" as const;
}
