import type { D1DatabaseLike } from "./campaignRepository.ts";

export type AccessRole = "admin" | "team-editor" | "viewer";

export type AccessContext = {
  grantId: string;
  campaignId: string;
  role: AccessRole;
  teamId: string | null;
  label: string | null;
};

export type AccessGrantSummary = AccessContext & {
  createdAt: string;
  revokedAt: string | null;
};

type AccessRow = {
  grant_id: string;
  campaign_id: string;
  role: AccessRole;
  team_id: string | null;
  label: string | null;
};

type GrantRow = {
  id: string;
  campaign_id: string;
  role: AccessRole;
  team_id: string | null;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
};

const SESSION_COOKIE = "vf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function randomSecret() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function sessionCookie(secret: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function resolveAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId?: string,
): Promise<AccessContext | null> {
  const sessionSecret = cookieValue(request, SESSION_COOKIE);
  if (!sessionSecret || sessionSecret.length > 256) return null;
  const sessionHash = await hashSecret(sessionSecret);
  const now = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT
         g.id AS grant_id, g.campaign_id, g.role, g.team_id, g.label
       FROM campaign_sessions s
       JOIN campaign_access_grants g
         ON g.id = s.grant_id AND g.campaign_id = s.campaign_id
       WHERE s.session_hash = ?
         AND s.expires_at > ?
         AND g.revoked_at IS NULL
         AND (? IS NULL OR g.campaign_id = ?)
       LIMIT 1`,
    )
    .bind(sessionHash, now, campaignId ?? null, campaignId ?? null)
    .first<AccessRow>();

  if (!row) return null;
  return {
    grantId: row.grant_id,
    campaignId: row.campaign_id,
    role: row.role,
    teamId: row.team_id,
    label: row.label,
  };
}

export async function createAccessGrant(
  db: D1DatabaseLike,
  input: {
    campaignId: string;
    role: AccessRole;
    teamId: string | null;
    label?: string | null;
  },
) {
  const token = randomSecret();
  const tokenHash = await hashSecret(token);
  const grantId = `grant_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const label = input.label?.trim().slice(0, 120) || null;

  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_access_grants
          (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        grantId,
        input.campaignId,
        input.role,
        input.teamId,
        tokenHash,
        label,
        createdAt,
      ),
  ]);

  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("access_grant_create_failed");

  return {
    token,
    grant: {
      grantId,
      campaignId: input.campaignId,
      role: input.role,
      teamId: input.teamId,
      label,
      createdAt,
      revokedAt: null,
    } satisfies AccessGrantSummary,
  };
}

export async function createSessionForGrant(
  db: D1DatabaseLike,
  grant: AccessContext,
) {
  const sessionSecret = randomSecret();
  const sessionHash = await hashSecret(sessionSecret);
  const sessionId = `session_${crypto.randomUUID()}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_SECONDS * 1000);

  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_sessions
          (id, grant_id, campaign_id, session_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sessionId,
        grant.grantId,
        grant.campaignId,
        sessionHash,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      ),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("session_create_failed");

  return { sessionSecret, expiresAt: expiresAt.toISOString() };
}

export async function redeemAccessToken(
  db: D1DatabaseLike,
  campaignId: string,
  token: string,
) {
  if (token.length < 32 || token.length > 256) return null;
  const tokenHash = await hashSecret(token);
  const row = await db
    .prepare(
      `SELECT id, campaign_id, role, team_id, label
       FROM campaign_access_grants
       WHERE token_hash = ? AND campaign_id = ? AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash, campaignId)
    .first<{
      id: string;
      campaign_id: string;
      role: AccessRole;
      team_id: string | null;
      label: string | null;
    }>();

  if (!row) return null;
  const access: AccessContext = {
    grantId: row.id,
    campaignId: row.campaign_id,
    role: row.role,
    teamId: row.team_id,
    label: row.label,
  };
  const session = await createSessionForGrant(db, access);
  return { access, ...session };
}

export async function listAccessGrants(db: D1DatabaseLike, campaignId: string) {
  const result = await db
    .prepare(
      `SELECT id, campaign_id, role, team_id, label, created_at, revoked_at
       FROM campaign_access_grants
       WHERE campaign_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(campaignId)
    .all<GrantRow>();

  return result.results.map(
    (row): AccessGrantSummary => ({
      grantId: row.id,
      campaignId: row.campaign_id,
      role: row.role,
      teamId: row.team_id,
      label: row.label,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    }),
  );
}

export async function revokeAccessGrant(
  db: D1DatabaseLike,
  campaignId: string,
  grantId: string,
) {
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaign_access_grants
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ? AND campaign_id = ?`,
      )
      .bind(new Date().toISOString(), grantId, campaignId),
  ]);
  return (result[0]?.meta?.changes ?? 0) === 1;
}

export async function campaignHasAccessGrants(db: D1DatabaseLike, campaignId: string) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM campaign_access_grants WHERE campaign_id = ?")
    .bind(campaignId)
    .first<{ count: number }>();
  return (row?.count ?? 0) > 0;
}

export async function teamExistsInCampaign(
  db: D1DatabaseLike,
  campaignId: string,
  teamId: string,
) {
  const row = await db
    .prepare("SELECT id FROM teams WHERE id = ? AND campaign_id = ?")
    .bind(teamId, campaignId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function revokeCurrentSession(db: D1DatabaseLike, request: Request) {
  const secret = cookieValue(request, SESSION_COOKIE);
  if (!secret) return;
  const hash = await hashSecret(secret);
  await db.batch([
    db.prepare("DELETE FROM campaign_sessions WHERE session_hash = ?").bind(hash),
  ]);
}
