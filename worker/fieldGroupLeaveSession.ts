import { hashSecret, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

const FIELD_GROUP_SESSION_COOKIE = "vf_field_group_session";

type LeaveSessionRow = {
  membership_id: string;
  campaign_id: string;
  group_id: string;
  team_id: string;
  label: string;
};

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

/**
 * Resolves only the identity needed to safely replay a leave request after the
 * membership has already been marked left. It must never be used as normal
 * authorization because it intentionally accepts inactive membership state.
 */
export async function resolveFieldGroupLeaveSession(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
): Promise<AccessContext | null> {
  const secret = cookieValue(request, FIELD_GROUP_SESSION_COOKIE);
  if (!secret || secret.length > 256) return null;
  const sessionHash = await hashSecret(secret);

  try {
    const row = await db
      .prepare(
        `SELECT
           m.id AS membership_id,
           m.campaign_id,
           m.group_id,
           m.team_id,
           g.label
         FROM field_group_memberships m
         JOIN field_groups g
           ON g.id = m.group_id AND g.campaign_id = m.campaign_id
         WHERE m.temp_session_hash = ? AND m.campaign_id = ?
         LIMIT 1`,
      )
      .bind(sessionHash, campaignId)
      .first<LeaveSessionRow>();
    if (!row) return null;

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
    return null;
  }
}
