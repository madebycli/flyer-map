import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { emitFieldGroupAudit } from "./fieldGroupAudit.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

type GroupRow = {
  team_id: string;
  state: "active" | "closed" | "expired";
  hard_expires_at: string;
};

type MemberRow = {
  id: string;
  campaign_grant_id: string | null;
  joined_at: string;
  grant_label: string | null;
};

type MemberRoute = {
  campaignId: string;
  groupId: string;
};

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function validSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

export function parseFieldGroupMembersRoute(pathname: string): MemberRoute | null {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/field-groups\/([^/]+)\/memberships$/u,
  );
  if (!match) return null;

  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const groupId = decodeURIComponent(match[2]);
    if (!campaignId || !validSelector(groupId)) return null;
    return { campaignId, groupId };
  } catch {
    return null;
  }
}

function canManage(access: AccessContext, teamId: string) {
  return access.role === "admin" ||
    (access.role === "team-editor" && access.teamId === teamId);
}

async function expireGroupIfNeeded(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  group: GroupRow,
  now: string,
) {
  if (group.state !== "active" || group.hard_expires_at > now) return group.state;

  const result = await db.batch([
    db
      .prepare(
        `UPDATE field_groups
         SET state = 'expired', closed_at = hard_expires_at, updated_at = ?
         WHERE id = ? AND campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
      )
      .bind(now, groupId, campaignId, now),
    db
      .prepare(
        `UPDATE field_group_join_credentials
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
      )
      .bind(group.hard_expires_at, groupId, campaignId),
  ]);

  if ((result[0]?.meta?.changes ?? 0) === 1) {
    emitFieldGroupAudit({
      kind: "field_group.expired",
      campaignId,
      groupId,
      teamId: group.team_id,
      actorKind: "system",
      at: group.hard_expires_at,
    });
  }
  return "expired" as const;
}

export async function handleFieldGroupMembersApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseFieldGroupMembersRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Für die Mitgliederliste ist nur GET erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) {
      return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    }

    const group = await db
      .prepare(
        `SELECT team_id, state, hard_expires_at
         FROM field_groups
         WHERE id = ? AND campaign_id = ?
         LIMIT 1`,
      )
      .bind(route.groupId, route.campaignId)
      .first<GroupRow>();
    if (!group) {
      return errorResponse(404, "group_not_found", "Gruppe wurde nicht gefunden.");
    }
    if (!canManage(access, group.team_id)) {
      return errorResponse(403, "group_manage_forbidden", "Diese Rolle darf Gruppenmitglieder nicht verwalten.");
    }

    const now = new Date().toISOString();
    const state = await expireGroupIfNeeded(db, route.campaignId, route.groupId, group, now);
    if (state !== "active") {
      return errorResponse(409, "group_not_active", "Gruppe ist nicht mehr aktiv.");
    }

    const rows = await db
      .prepare(
        `SELECT
           m.id,
           m.campaign_grant_id,
           m.joined_at,
           g.label AS grant_label
         FROM field_group_memberships m
         LEFT JOIN campaign_access_grants g
           ON g.id = m.campaign_grant_id AND g.campaign_id = m.campaign_id
         WHERE m.group_id = ? AND m.campaign_id = ?
           AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ORDER BY m.joined_at, m.id`,
      )
      .bind(route.groupId, route.campaignId, now)
      .all<MemberRow>();

    return json({
      members: rows.results.map((member) => ({
        id: member.id,
        kind: member.campaign_grant_id ? "campaign-access" : "temporary",
        label: member.campaign_grant_id
          ? member.grant_label?.trim() || "Campaign-Zugriff"
          : "Temporäres Mitglied",
        joinedAt: member.joined_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table.*field_group|field_group.*does not exist/iu.test(message)) {
      return errorResponse(
        503,
        "field_group_schema_unavailable",
        "Field-Group-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "field_group_members_failed", "Gruppenmitglieder konnten nicht geladen werden.");
  }
}
