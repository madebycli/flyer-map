import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { emitFieldGroupAudit } from "./fieldGroupAudit.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

export type OrganizationFieldGroupListEnv = {
  DB?: D1DatabaseLike;
};

type FieldGroupRow = {
  id: string;
  campaign_id: string;
  team_id: string;
  label: string;
  mode: "distribution" | "collection";
  discoverable: number;
  state: "active" | "closed" | "expired";
  participant_count: number | null;
  created_at: string;
  hard_expires_at: string;
  closed_at: string | null;
  updated_at: string;
  team_name: string;
  team_color: string;
  join_available: number;
  membership_count: number;
};

type ExpiringGroupRow = {
  id: string;
  team_id: string;
  hard_expires_at: string;
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

function routeCampaignId(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/field-groups$/u);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function validTeamSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function publicGroup(row: FieldGroupRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    teamId: row.team_id,
    teamName: row.team_name,
    teamColor: row.team_color,
    label: row.label,
    mode: row.mode,
    discoverable: row.discoverable === 1,
    state: row.state,
    participantCount: row.participant_count,
    createdAt: row.created_at,
    hardExpiresAt: row.hard_expires_at,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
    joinAvailable: row.join_available === 1,
    membershipCount: row.membership_count,
  };
}

export function fieldGroupListScope(access: AccessContext, requestedTeamId: string | null) {
  if (requestedTeamId && !validTeamSelector(requestedTeamId)) {
    return { ok: false as const, status: 400, code: "invalid_team_filter" };
  }

  if (access.role === "field-group-member") {
    if (!access.groupId || !access.teamId) {
      return { ok: false as const, status: 403, code: "field_group_scope_forbidden" };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return { ok: false as const, status: 403, code: "group_scope_forbidden" };
    }
    return {
      ok: true as const,
      groupId: access.groupId,
      teamId: access.teamId,
      discoverableOnly: false,
    };
  }

  if (access.role === "team-editor") {
    if (!access.teamId) {
      return { ok: false as const, status: 403, code: "editor_team_scope_missing" };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return { ok: false as const, status: 403, code: "group_scope_forbidden" };
    }
    return {
      ok: true as const,
      groupId: null,
      teamId: access.teamId,
      discoverableOnly: false,
    };
  }

  if (access.role === "viewer") {
    if (access.teamId && requestedTeamId && requestedTeamId !== access.teamId) {
      return { ok: false as const, status: 403, code: "group_scope_forbidden" };
    }
    return {
      ok: true as const,
      groupId: null,
      teamId: access.teamId ?? requestedTeamId,
      discoverableOnly: true,
    };
  }

  if (access.role !== "admin") {
    return { ok: false as const, status: 403, code: "group_scope_forbidden" };
  }

  return {
    ok: true as const,
    groupId: null,
    teamId: requestedTeamId,
    discoverableOnly: false,
  };
}

export async function expireOrganizationFieldGroups(
  db: D1DatabaseLike,
  campaignId: string,
  now: string,
) {
  const expiring = await db
    .prepare(
      `SELECT id, team_id, hard_expires_at
       FROM field_groups
       WHERE campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
    )
    .bind(campaignId, now)
    .all<ExpiringGroupRow>();

  for (const group of expiring.results) {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE field_groups
           SET state = 'expired', closed_at = hard_expires_at, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
        )
        .bind(now, group.id, campaignId, now),
      db
        .prepare(
          `UPDATE field_group_join_credentials
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
        )
        .bind(group.hard_expires_at, group.id, campaignId),
      db
        .prepare(
          `DELETE FROM field_group_recoverable_credentials
           WHERE credential_id IN (
             SELECT id FROM field_group_join_credentials
             WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NOT NULL
           )`,
        )
        .bind(group.id, campaignId),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 1) {
      emitFieldGroupAudit({
        kind: "field_group.expired",
        campaignId,
        groupId: group.id,
        teamId: group.team_id,
        actorKind: "system",
        at: group.hard_expires_at,
      });
    }
  }
}

async function listRows(
  db: D1DatabaseLike,
  campaignId: string,
  scope: Extract<ReturnType<typeof fieldGroupListScope>, { ok: true }>,
) {
  const now = new Date().toISOString();
  const conditions = ["g.campaign_id = ?", "g.state = 'active'", "g.hard_expires_at > ?"];
  const values: unknown[] = [campaignId, now];

  if (scope.groupId) {
    conditions.push("g.id = ?");
    values.push(scope.groupId);
  }
  if (scope.teamId) {
    conditions.push("g.team_id = ?");
    values.push(scope.teamId);
  }
  if (scope.discoverableOnly) conditions.push("g.discoverable = 1");

  const result = await db
    .prepare(
      `SELECT
         g.id, g.campaign_id, g.team_id, g.label, g.mode, g.discoverable, g.state,
         g.participant_count, g.created_at, g.hard_expires_at, g.closed_at, g.updated_at,
         t.name AS team_name, t.color AS team_color,
         CASE WHEN EXISTS (
           SELECT 1 FROM field_group_join_credentials c
           WHERE c.group_id = g.id AND c.campaign_id = g.campaign_id AND c.revoked_at IS NULL
         ) THEN 1 ELSE 0 END AS join_available,
         (
           SELECT COUNT(*) FROM field_group_memberships m
           WHERE m.group_id = g.id AND m.campaign_id = g.campaign_id
             AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ) AS membership_count
       FROM field_groups g
       JOIN teams t ON t.id = g.team_id AND t.campaign_id = g.campaign_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY g.created_at DESC, g.id DESC`,
    )
    .bind(now, ...values)
    .all<FieldGroupRow>();
  return result.results;
}

function fieldGroupSchemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no such (?:table|column)|does not exist).*field[_ ]group|field[_ ]group.*(?:no such (?:table|column)|does not exist)/iu.test(message);
}

export async function handleOrganizationFieldGroupList(
  request: Request,
  env: OrganizationFieldGroupListEnv,
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const campaignId = routeCampaignId(url.pathname);
  if (!campaignId) return null;
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist für diesen Worker nicht gebunden.");

  const access = await resolveAccess(env.DB, request, campaignId);
  if (!access) {
    return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
  }

  const scope = fieldGroupListScope(access, url.searchParams.get("team"));
  if (!scope.ok) {
    return errorResponse(scope.status, scope.code, "Dieser Room-Filter liegt außerhalb deines Zugriffs.");
  }

  try {
    await expireOrganizationFieldGroups(env.DB, campaignId, new Date().toISOString());
    const groups = await listRows(env.DB, campaignId, scope);
    return json({ groups: groups.map(publicGroup) });
  } catch (error) {
    if (fieldGroupSchemaUnavailable(error)) {
      return errorResponse(
        503,
        "field_group_schema_unavailable",
        "Live-Gruppen benötigen die vorbereitete Datenbankmigration.",
      );
    }
    throw error;
  }
}
