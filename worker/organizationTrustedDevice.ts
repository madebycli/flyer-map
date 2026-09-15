import { cookieValue, hashSecret, randomSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  createTrustedDevice,
  consumeTrustedDevice,
  revokeTrustedDeviceBySecret,
  TRUSTED_DEVICE_ABSOLUTE_SECONDS,
  type TrustedDeviceAssurance,
} from "./trustedDevice.ts";

const SESSION_SECONDS = 60 * 60 * 12;
export const ORGANIZATION_REMEMBER_COOKIE = "__Host-vf_organization_remember";

type OrganizationSubjectRow = {
  id: string;
  username: string;
  disabled_at: string | null;
  mfa_required: number;
};

function rememberCookieValue(request: Request) {
  return cookieValue(request, ORGANIZATION_REMEMBER_COOKIE);
}

export function organizationRememberCookie(secret: string) {
  return `${ORGANIZATION_REMEMBER_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRUSTED_DEVICE_ABSOLUTE_SECONDS}`;
}

export function clearOrganizationRememberCookie() {
  return `${ORGANIZATION_REMEMBER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createOrganizationRememberedDevice(
  db: D1DatabaseLike,
  accountId: string,
  assurance: TrustedDeviceAssurance,
) {
  return createTrustedDevice(db, {
    subjectKind: "organization_account",
    subjectId: accountId,
    assurance,
  });
}

async function subjectRow(db: D1DatabaseLike, accountId: string) {
  return db.prepare(
    `SELECT id, username, disabled_at, mfa_required
     FROM organization_accounts
     WHERE id = ?
     LIMIT 1`,
  ).bind(accountId).first<OrganizationSubjectRow>();
}

async function createSession(db: D1DatabaseLike, accountId: string, assurance: "mfa") {
  const secret = randomSecret();
  const sessionHash = await hashSecret(secret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db.prepare(
      `INSERT INTO organization_account_sessions
        (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      `org_session_${crypto.randomUUID()}`,
      accountId,
      sessionHash,
      assurance,
      now.toISOString(),
      expiresAt,
    ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("organization_session_create_failed");
  return { secret, expiresAt, assurance };
}

function trustedAssuranceMatchesAccount(assurance: string | null, account: OrganizationSubjectRow) {
  if (assurance === "mfa") return account.mfa_required === 1;
  if (assurance === "password") return account.mfa_required === 0;
  return false;
}

export async function refreshOrganizationRememberedDevice(db: D1DatabaseLike, request: Request) {
  const secret = rememberCookieValue(request);
  if (!secret) return { ok: false as const, code: "missing" as const };
  const consumed = await consumeTrustedDevice(db, {
    subjectKind: "organization_account",
    secret,
    validateSubject: async (accountId, assurance) => {
      const account = await subjectRow(db, accountId);
      return Boolean(account && !account.disabled_at && trustedAssuranceMatchesAccount(assurance, account));
    },
  });
  if (!consumed.ok) return consumed;
  const account = await subjectRow(db, consumed.subjectId);
  if (!account || account.disabled_at || !trustedAssuranceMatchesAccount(consumed.assurance, account)) {
    return { ok: false as const, code: "subject_invalid" as const };
  }
  // Existing optional-MFA organization sessions intentionally use the platform's
  // established "mfa" short-session assurance even when the remembered-device
  // credential itself records password-only assurance. Enabling/disabling MFA
  // revokes trusted-device families, so a password-only device cannot survive a
  // later transition to required MFA.
  const session = await createSession(db, account.id, "mfa");
  return {
    ok: true as const,
    account: { id: account.id, username: account.username },
    session,
    rememberSecret: consumed.token.secret,
  };
}

export async function revokeCurrentOrganizationRememberedDevice(db: D1DatabaseLike, request: Request) {
  const secret = rememberCookieValue(request);
  if (!secret) return;
  await revokeTrustedDeviceBySecret(db, "organization_account", secret);
}
