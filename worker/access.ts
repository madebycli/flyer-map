import type { D1DatabaseLike } from "./campaignRepository.ts";
import { resolveCampaignAdminAccountAccess } from "./adminAuth.ts";
import { resolveOrganizationCampaignOrganizerAccess } from "./organizationCampaignAccess.ts";

export type PersistentAccessRole = "admin" | "team-editor" | "viewer";
export type AccessRole = PersistentAccessRole | "field-group-member" | "collection-collector";

export type AccessContext = {
  grantId: string;
  campaignId: string;
  role: AccessRole;
  teamId: string | null;
  label: string | null;
  groupId?: string | null;
  membershipId?: string | null;
  collectorId?: string | null;
  collectionAccessId?: string | null;
};

export type AccessGrantSummary = Omit<AccessContext, "role" | "groupId" | "membershipId"> & {
  role: PersistentAccessRole;
  createdAt: string;
  revokedAt: string | null;
};

type AccessRow = {
  grant_id: string;
  campaign_id: string;
  role: PersistentAccessRole;
  team_id: string | null;
  label: string | null;
};

type GrantRow = {
  id: string;
  campaign_id: string;
  role: PersistentAccessRole;
  team_id: string | null;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
};

type FieldGroupAccessRow = {
  membership_id: string;
  campaign_id: string;
  group_id: string;
  team_id: string;
  expires_at: string;
  left_at: string | null;
  removed_at: string | null;
  label: string;
  state: "active" | "closed" | "expired";
  hard_expires_at: string;
};

const SESSION_COOKIE = "vf_session";
const FIELD_GROUP_SESSION_COOKIE = "vf_field_group_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const FIELD_GROUP_SESSION_SECONDS = 60 * 60 * 24;

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

export function cookieValue(request: Request, name: string) {
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

export function fieldGroupSessionCookie(secret: string) {
  return `${FIELD_GROUP_SESSION_COOKIE}=${encodeURIComponent(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${FIELD_GROUP_SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function clearFieldGroupSessionCookie() {
  return `${FIELD_GROUP_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function resolvePersistentAccess(
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
    groupId: null,
    membershipId: null,
  };
}

async function expireFieldGroupForSession(
  db: D1DatabaseLike,
  row: FieldGroupAccessRow,
  now: string,
) {
  await db.batch([
    db
      .prepare(
        `UPDATE field_groups
         SET state = 'expired', closed_at = hard_expires_at, updated_at = ?
         WHERE id = ? AND campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
      )
      .bind(now, row.group_id, row.campaign_id, now),
    db
      .prepare(
        `UPDATE field_group_join_credentials
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
      )
      .bind(row.hard_expires_at, row.group_id, row.campaign_id),
  ]);
}

async function resolveFieldGroupAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId?: string,
): Promise<AccessContext | null> {
  const sessionSecret = cookieValue(request, FIELD_GROUP_SESSION_COOKIE);
  if (!sessionSecret || sessionSecret.length > 256) return null;
  const sessionHash = await hashSecret(sessionSecret);
  const now = new Date().toISOString();

  try {
    const row = await db
      .prepare(
        `SELECT
           m.id AS membership_id,
           m.campaign_id,
           m.group_id,
           m.team_id,
           m.expires_at,
           m.left_at,
           m.removed_at,
           g.label,
           g.state,
           g.hard_expires_at
         FROM field_group_memberships m
         JOIN field_groups g
           ON g.id = m.group_id AND g.campaign_id = m.campaign_id
         WHERE m.temp_session_hash = ?
           AND (? IS NULL OR m.campaign_id = ?)
         LIMIT 1`,
      )
      .bind(sessionHash, campaignId ?? null, campaignId ?? null)
      .first<FieldGroupAccessRow>();

    if (!row || row.left_at || row.removed_at || row.expires_at <= now) return null;
    if (row.state === "active" && row.hard_expires_at <= now) {
      await expireFieldGroupForSession(db, row, now);
      return null;
    }
    if (row.state !== "active") return null;

    return {
      grantId: `field-group:${row.membership_id}`,
      campaignId: row.campaign_id,
      role: "field-group-member",
      teamId: row.team_id,
      label: row.label,
      groupId: row.group_id,
      membershipId: row.membership_id,
    };
  } catch {
    // Migration 0006 may intentionally not be applied yet. Existing campaign
    // access must remain available until the FC1 schema is rolled out.
    return null;
  }
}

export async function resolveAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId?: string,
): Promise<AccessContext | null> {
  const persistent = await resolvePersistentAccess(db, request, campaignId);
  if (persistent) return persistent;
  const account = await resolveCampaignAdminAccountAccess(db, request, campaignId);
  if (account) return account;
  const organizer = await resolveOrganizationCampaignOrganizerAccess(db, request, campaignId);
  if (organizer) {
    return {
      grantId: `organization:${organizer.membershipId}`,
      campaignId: organizer.campaignId,
      role: "admin",
      teamId: null,
      label: "Organizer",
      groupId: null,
      membershipId: null,
    };
  }
  return resolveFieldGroupAccess(db, request, campaignId);
}

export async function createAccessGrant(
  db: D1DatabaseLike,
  input: {
    campaignId: string;
    role: PersistentAccessRole;
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
  if (grant.role === "field-group-member" || grant.role === "collection-collector") {
    throw new Error("persistent_session_role_required");
  }
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
      role: PersistentAccessRole;
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
    groupId: null,
    membershipId: null,
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
  if (secret) {
    const hash = await hashSecret(secret);
    await db.batch([
      db.prepare("DELETE FROM campaign_sessions WHERE session_hash = ?").bind(hash),
    ]);
  }

  const fieldGroupSecret = cookieValue(request, FIELD_GROUP_SESSION_COOKIE);
  if (!fieldGroupSecret) return;
  const fieldGroupHash = await hashSecret(fieldGroupSecret);
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE field_group_memberships
           SET left_at = COALESCE(left_at, ?)
           WHERE temp_session_hash = ? AND removed_at IS NULL`,
        )
        .bind(new Date().toISOString(), fieldGroupHash),
    ]);
  } catch {
    // Migration 0006 may not be applied yet.
  }
}
