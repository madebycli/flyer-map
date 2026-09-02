import type { D1DatabaseLike } from "./campaignRepository.ts";
import type { AccessContext } from "./access.ts";
import { hashSecret, randomSecret, resolvePersistentAccess, type AccessRole } from "./access.ts";

const COLLECTION_SESSION_COOKIE = "vf_collection_session";
const COLLECTION_SESSION_SECONDS = 60 * 60 * 24;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

export type CollectionAccessLinkSummary = {
  id: string; campaignId: string; createdAt: string; revokedAt: string | null;
};
export type CollectionCollectorSummary = {
  id: string; campaignId: string; accessLinkId: string; label: string;
  createdAt: string; revokedAt: string | null;
};

type CollectionAccessRow = {
  collector_id: string; campaign_id: string; access_link_id: string; label: string;
  expires_at: string; session_revoked_at: string | null; collector_revoked_at: string | null;
};

function collectionCookieValue(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COLLECTION_SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function collectionSessionCookie(secret: string) {
  return COLLECTION_SESSION_COOKIE + "=" + encodeURIComponent(secret) +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + COLLECTION_SESSION_SECONDS;
}
export function clearCollectionSessionCookie() {
  return COLLECTION_SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
export function isCollectionSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*collection_|collection_.*does not exist/iu.test(message);
}

export async function resolveCollectionAccess(
  db: D1DatabaseLike, request: Request, campaignId?: string,
): Promise<AccessContext | null> {
  const secret = collectionCookieValue(request);
  if (!secret || secret.length > 256) return null;
  const now = new Date().toISOString();
  try {
    const row = await db.prepare(
      `SELECT s.collector_id, s.campaign_id, c.access_link_id, c.label,
                s.expires_at, s.revoked_at AS session_revoked_at,
                c.revoked_at AS collector_revoked_at
           FROM collection_collector_sessions s
           JOIN collection_collectors c
             ON c.id = s.collector_id AND c.campaign_id = s.campaign_id
           JOIN collection_access_links l
             ON l.id = c.access_link_id AND l.campaign_id = c.campaign_id
          WHERE s.session_hash = ?
            AND (? IS NULL OR s.campaign_id = ?)
          LIMIT 1`
    ).bind(await hashSecret(secret), campaignId ?? null, campaignId ?? null).first<CollectionAccessRow>();
    if (!row || row.expires_at <= now || row.session_revoked_at || row.collector_revoked_at) return null;
    return {
      grantId: "collection:" + row.collector_id, campaignId: row.campaign_id,
      role: "collection-collector" as AccessRole, teamId: null, label: row.label,
      groupId: null, membershipId: null, collectorId: row.collector_id,
      collectionAccessId: row.access_link_id,
    };
  } catch (error) {
    if (isCollectionSchemaError(error)) return null;
    throw error;
  }
}

export async function createCollectionAccessLink(db: D1DatabaseLike, campaignId: string) {
  const token = randomSecret() + randomSecret();
  const linkId = "collection_access_" + crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE collection_access_links
          SET revoked_at = COALESCE(revoked_at, ?)
        WHERE campaign_id = ? AND revoked_at IS NULL`
    ).bind(createdAt, campaignId),
    db.prepare(
      `INSERT INTO collection_access_links
          (id, campaign_id, token_hash, created_at, revoked_at)
        VALUES (?, ?, ?, ?, NULL)`
    ).bind(linkId, campaignId, await hashSecret(token), createdAt),
  ]);
  return {
    token,
    link: { id: linkId, campaignId, createdAt, revokedAt: null } satisfies CollectionAccessLinkSummary,
  };
}

export async function redeemCollectionAccess(db: D1DatabaseLike, campaignId: string, token: string) {
  if (token.length < 64 || token.length > 256) return null;
  const link = await db.prepare(
    `SELECT id FROM collection_access_links
       WHERE token_hash = ? AND campaign_id = ? AND revoked_at IS NULL LIMIT 1`
  ).bind(await hashSecret(token), campaignId).first<{ id: string }>();
  if (!link) return null;
  const count = await db.prepare(
    "SELECT COUNT(*) AS count FROM collection_collectors WHERE campaign_id = ?"
  ).bind(campaignId).first<{ count: number }>();
  const now = new Date().toISOString();
  const label = "Nutzer " + ((count?.count ?? 0) + 1);
  const collectorId = "collector_" + crypto.randomUUID();
  const sessionId = "collection_session_" + crypto.randomUUID();
  const sessionSecret = randomSecret();
  const expiresAt = new Date(Date.now() + COLLECTION_SESSION_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO collection_collectors
          (id, campaign_id, access_link_id, label, created_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, NULL)`
    ).bind(collectorId, campaignId, link.id, label, now),
    db.prepare(
      `INSERT INTO collection_collector_sessions
          (id, collector_id, campaign_id, session_hash, created_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).bind(sessionId, collectorId, campaignId, await hashSecret(sessionSecret), now, expiresAt),
  ]);
  return {
    access: {
      grantId: "collection:" + collectorId, campaignId, role: "collection-collector" as const,
      teamId: null, label, groupId: null, membershipId: null,
      collectorId, collectionAccessId: link.id,
    },
    sessionSecret,
  };
}

export async function listCollectionAccessLinks(db: D1DatabaseLike, campaignId: string) {
  const result = await db.prepare(
    `SELECT id, campaign_id, created_at, revoked_at
       FROM collection_access_links WHERE campaign_id = ?
       ORDER BY created_at DESC, id DESC`
  ).bind(campaignId).all<{
    id: string; campaign_id: string; created_at: string; revoked_at: string | null;
  }>();
  return result.results.map((row) => ({
    id: row.id, campaignId: row.campaign_id, createdAt: row.created_at, revokedAt: row.revoked_at,
  } satisfies CollectionAccessLinkSummary));
}

export async function listCollectionCollectors(db: D1DatabaseLike, campaignId: string) {
  const result = await db.prepare(
    `SELECT id, campaign_id, access_link_id, label, created_at, revoked_at
       FROM collection_collectors WHERE campaign_id = ?
       ORDER BY created_at DESC, id DESC`
  ).bind(campaignId).all<{
    id: string; campaign_id: string; access_link_id: string; label: string;
    created_at: string; revoked_at: string | null;
  }>();
  return result.results.map((row) => ({
    id: row.id, campaignId: row.campaign_id, accessLinkId: row.access_link_id,
    label: row.label, createdAt: row.created_at, revokedAt: row.revoked_at,
  } satisfies CollectionCollectorSummary));
}

export async function revokeCollectionCollector(db: D1DatabaseLike, campaignId: string, collectorId: string) {
  if (!ID_PATTERN.test(collectorId)) return false;
  const revokedAt = new Date().toISOString();
  const result = await db.batch([
    db.prepare(
      `UPDATE collection_collectors SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ? AND campaign_id = ?`
    ).bind(revokedAt, collectorId, campaignId),
    db.prepare(
      `UPDATE collection_collector_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE collector_id = ? AND campaign_id = ?`
    ).bind(revokedAt, collectorId, campaignId),
  ]);
  return (result[0]?.meta?.changes ?? 0) === 1;
}

export async function revokeCollectionSession(db: D1DatabaseLike, request: Request) {
  const secret = collectionCookieValue(request);
  if (!secret) return;
  await db.batch([
    db.prepare(
      `UPDATE collection_collector_sessions
          SET revoked_at = COALESCE(revoked_at, ?)
        WHERE session_hash = ?`
    ).bind(new Date().toISOString(), await hashSecret(secret)),
  ]);
}

export async function persistentAccessForCollection(
  db: D1DatabaseLike, request: Request, campaignId: string,
) {
  return resolvePersistentAccess(db, request, campaignId);
}
