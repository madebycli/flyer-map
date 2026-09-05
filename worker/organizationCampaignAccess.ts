import type { D1DatabaseLike } from "./campaignRepository.ts";

const ORGANIZATION_SESSION_COOKIE = "__Host-vf_organization_session";

type OrganizationCampaignAccessRow = {
  membership_id: string;
  campaign_id: string;
  role_kind: "organizer" | "admin";
  capabilities_json: string;
  template_capabilities_json: string | null;
};

export type OrganizationCampaignOrganizerAccess = {
  membershipId: string;
  campaignId: string;
  organizationRole: "organizer" | "admin";
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

function hasCampaignManage(value: string | null) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.includes("campaign.manage");
  } catch {
    return false;
  }
}

/**
 * Bridges a central Organization identity into the existing Campaign
 * authorization layer without creating a legacy Campaign grant or session.
 *
 * Organizers always receive Campaign-admin access for Campaigns owned by their
 * Organization. Organization Admins receive the same bridge only when their
 * effective membership/template capabilities contain campaign.manage.
 * Recovery-assurance sessions never cross this boundary.
 *
 * Production may not have the Organization schema yet. Any schema/runtime
 * failure therefore fails closed and leaves legacy Campaign access untouched.
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
        `SELECT m.id AS membership_id, c.id AS campaign_id, m.role_kind,
                m.capabilities_json,
                r.capabilities_json AS template_capabilities_json
         FROM organization_account_sessions s
         JOIN organization_accounts a
           ON a.id = s.account_id AND a.disabled_at IS NULL
         JOIN organization_memberships m
           ON m.account_id = s.account_id
          AND m.disabled_at IS NULL
         LEFT JOIN organization_role_templates r
           ON r.id = m.role_template_id
          AND r.organization_id = m.organization_id
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

    if (!row) return null;
    if (
      row.role_kind !== "organizer" &&
      !hasCampaignManage(row.capabilities_json) &&
      !hasCampaignManage(row.template_capabilities_json)
    ) {
      return null;
    }
    return {
      membershipId: row.membership_id,
      campaignId: row.campaign_id,
      organizationRole: row.role_kind,
    };
  } catch {
    return null;
  }
}