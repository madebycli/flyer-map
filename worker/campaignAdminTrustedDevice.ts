import { cookieValue, hashSecret, randomSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  createTrustedDevice,
  consumeTrustedDevice,
  revokeTrustedDeviceBySecret,
  TRUSTED_DEVICE_ABSOLUTE_SECONDS,
} from "./trustedDevice.ts";

const SESSION_SECONDS = 60 * 60 * 12;
export const CAMPAIGN_ADMIN_REMEMBER_COOKIE = "__Host-vf_campaign_admin_remember";

type CampaignAdminSubjectRow = {
  id: string;
  campaign_id: string;
  grant_id: string;
  username: string;
  username_normalized: string;
  disabled_at: string | null;
  grant_revoked_at: string | null;
};

function rememberCookieValue(request: Request) {
  return cookieValue(request, CAMPAIGN_ADMIN_REMEMBER_COOKIE);
}

export function campaignAdminRememberCookie(secret: string) {
  return `${CAMPAIGN_ADMIN_REMEMBER_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRUSTED_DEVICE_ABSOLUTE_SECONDS}`;
}

export function clearCampaignAdminRememberCookie() {
  return `${CAMPAIGN_ADMIN_REMEMBER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function subjectRow(db: D1DatabaseLike, accountId: string) {
  return db.prepare(
    `SELECT a.id, a.campaign_id, a.grant_id, a.username, a.username_normalized,
            a.disabled_at, g.revoked_at AS grant_revoked_at
     FROM campaign_admin_accounts a
     JOIN campaign_access_grants g ON g.id = a.grant_id AND g.campaign_id = a.campaign_id
     WHERE a.id = ?
     LIMIT 1`,
  ).bind(accountId).first<CampaignAdminSubjectRow>();
}

export async function campaignAdminAccountIdByUsername(
  db: D1DatabaseLike,
  campaignId: string,
  username: string,
) {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;
  const row = await db.prepare(
    `SELECT id FROM campaign_admin_accounts
     WHERE campaign_id = ? AND username_normalized = ? AND disabled_at IS NULL
     LIMIT 1`,
  ).bind(campaignId, normalized).first<{ id: string }>();
  return row?.id ?? null;
}

export async function createCampaignAdminRememberedDevice(db: D1DatabaseLike, accountId: string) {
  return createTrustedDevice(db, {
    subjectKind: "campaign_admin",
    subjectId: accountId,
    assurance: "password",
  });
}

async function createSession(db: D1DatabaseLike, row: CampaignAdminSubjectRow) {
  const secret = randomSecret();
  const sessionHash = await hashSecret(secret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db.prepare(
      `INSERT INTO campaign_admin_sessions
        (id, campaign_id, account_id, session_hash, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      `admin_session_${crypto.randomUUID()}`,
      row.campaign_id,
      row.id,
      sessionHash,
      now.toISOString(),
      expiresAt,
    ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("admin_session_create_failed");
  return { sessionSecret: secret, expiresAt };
}

export async function refreshCampaignAdminRememberedDevice(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
) {
  const secret = rememberCookieValue(request);
  if (!secret) return { ok: false as const, code: "missing" as const };
  const consumed = await consumeTrustedDevice(db, {
    subjectKind: "campaign_admin",
    secret,
    validateSubject: async (accountId, assurance) => {
      const account = await subjectRow(db, accountId);
      return Boolean(
        account &&
        account.campaign_id === campaignId &&
        !account.disabled_at &&
        !account.grant_revoked_at &&
        assurance === "password"
      );
    },
  });
  if (!consumed.ok) return consumed;
  const account = await subjectRow(db, consumed.subjectId);
  if (!account || account.campaign_id !== campaignId || account.disabled_at || account.grant_revoked_at) {
    return { ok: false as const, code: "subject_invalid" as const };
  }
  const session = await createSession(db, account);
  return {
    ok: true as const,
    campaignId: account.campaign_id,
    accountId: account.id,
    username: account.username,
    session,
    rememberSecret: consumed.token.secret,
  };
}

export async function revokeCurrentCampaignAdminRememberedDevice(db: D1DatabaseLike, request: Request) {
  const secret = rememberCookieValue(request);
  if (!secret) return;
  await revokeTrustedDeviceBySecret(db, "campaign_admin", secret);
}
