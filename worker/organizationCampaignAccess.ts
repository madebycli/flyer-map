import type { D1DatabaseLike } from "./campaignRepository.ts";

const ORGANIZATION_SESSION_COOKIE = "__Host-vf_organization_session";

type OrganizationCampaignAccessRow = {
  membership_id: string;
  campaign_id: string;
};

export type OrganizationCampaignOrganizerAccess = {
  membershipId: string;
  campaignId: string;
};

function organizationSessionSecret(request: Request) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rawValue] = part.trim().split("=");
    if (name === ORGANIZATION_SESSION_COOKIE) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

async function hashOrganizationSessionSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Bridges an authenticated Organization Organizer into the existing Campaign
 * authorization layer without creating a legacy Campaign grant or session.
 *
 * The bridge is intentionally Organizer-only for now. Organization Admins
 * need an explicit capability/team mapping before they can inherit legacy
 * Campaign roles. Recovery-assurance sessions are also excluded.
 *
 * Production may not have the Organization schema yet. Any schema/runtime
 * failure therefore fails closed and leaves the existing Campaign access
 * mechanisms available instead of turning an optional bridge into a 500.
 */
export async function resolveOrganizationCampaignOrganizerAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId?: string,
): Promise<OrganizationCampaignOrganizerAccess | null> {
  if (!campaignId) return null;
  const secret = organizationSessionSecret(request);
  if (!secret || secret.length > 256) return null;

  const sessionHash = await hashOrganizationSessionSecret(secret);
  const now = new Date().toISOString();

  try {
    const row = await db
      .prepare(
        `SELECT m.id AS membership_id, c.id AS campaign_id
         FROM organization_account_sessions s
         JOIN organization_accounts a
           ON a.id = s.account_id AND a.disabled_at IS NULL
         JOIN organization_memberships m
           ON m.account_id = s.account_id
          AND m.disabled_at IS NULL
          AND m.role_kind = 'organizer'
         JOIN campaigns c
           ON c.id = ?
          AND c.organization_id = m.organization_id
          AND c.organization_id IS NOT NULL
         WHERE s.session_hash = ?
           AND s.expires_at > ?
           AND s.revoked_at IS NULL
           AND s.assurance = 'mfa'
         LIMIT 1`,
      )
      .bind(campaignId, sessionHash, now)
      .first<OrganizationCampaignAccessRow>();

    return row
      ? { membershipId: row.membership_id, campaignId: row.campaign_id }
      : null;
  } catch {
    return null;
  }
}
