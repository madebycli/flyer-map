import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

export type TeamCommentsSummaryEnv = { DB?: D1DatabaseLike };

type SummaryRow = {
  id: string;
  target_type: "campaign" | "area" | "street-task" | "house-task";
  target_id: string;
  team_id: string | null;
  body: string;
  author_kind: string;
  created_at: string;
  updated_at: string;
  area_id: string | null;
  area_name: string | null;
  target_label: string | null;
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
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/team-comments$/u);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function validSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

export function teamCommentScope(access: AccessContext, requested: string | null) {
  const requestedTeamId = requested && requested !== "all" ? requested : null;
  if (requestedTeamId && !validSelector(requestedTeamId)) {
    return { ok: false as const, status: 400, code: "invalid_team_filter" };
  }

  if (access.role === "admin") {
    return { ok: true as const, teamId: requestedTeamId, includeCampaign: requested === "all" || !requested };
  }

  if (access.role === "team-editor" || access.role === "field-group-member") {
    if (!access.teamId) {
      return { ok: false as const, status: 403, code: "team_scope_required" };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return { ok: false as const, status: 403, code: "team_scope_forbidden" };
    }
    return { ok: true as const, teamId: access.teamId, includeCampaign: false };
  }

  if (access.role === "viewer") {
    if (access.teamId) {
      if (requestedTeamId && requestedTeamId !== access.teamId) {
        return { ok: false as const, status: 403, code: "team_scope_forbidden" };
      }
      return { ok: true as const, teamId: access.teamId, includeCampaign: false };
    }
    return { ok: true as const, teamId: requestedTeamId, includeCampaign: requested === "all" || !requested };
  }

  return { ok: false as const, status: 403, code: "team_scope_forbidden" };
}

function authorLabel(kind: string) {
  if (kind === "temporary-member") return "Room-Mitglied";
  if (kind === "campaign-grant") return "Team-Zugang";
  if (kind === "collection-collector") return "Collection-Helfer";
  return "Zugriff";
}

async function teamExists(db: D1DatabaseLike, campaignId: string, teamId: string) {
  const row = await db
    .prepare("SELECT id FROM teams WHERE id = ? AND campaign_id = ? LIMIT 1")
    .bind(teamId, campaignId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function loadSummary(
  db: D1DatabaseLike,
  campaignId: string,
  teamId: string | null,
  includeCampaign: boolean,
) {
  const scopeSql = teamId
    ? "AND c.team_id = ?"
    : includeCampaign
      ? ""
      : "AND c.team_id IS NOT NULL";
  const statement = db.prepare(
    `SELECT
       c.id, c.target_type, c.target_id, c.team_id, c.body, c.author_kind,
       c.created_at, c.updated_at,
       CASE
         WHEN c.target_type = 'area' THEN area_direct.id
         WHEN c.target_type = 'street-task' THEN area_street.id
         WHEN c.target_type = 'house-task' THEN area_house.id
         ELSE NULL
       END AS area_id,
       CASE
         WHEN c.target_type = 'area' THEN area_direct.name
         WHEN c.target_type = 'street-task' THEN area_street.name
         WHEN c.target_type = 'house-task' THEN area_house.name
         ELSE NULL
       END AS area_name,
       CASE
         WHEN c.target_type = 'area' THEN area_direct.name
         WHEN c.target_type = 'street-task' THEN street.label
         WHEN c.target_type = 'house-task' THEN house.label
         WHEN c.target_type = 'campaign' THEN campaign.name
         ELSE NULL
       END AS target_label
     FROM comments c
     LEFT JOIN campaigns campaign
       ON c.target_type = 'campaign' AND campaign.id = c.target_id AND campaign.id = c.campaign_id
     LEFT JOIN areas area_direct
       ON c.target_type = 'area' AND area_direct.id = c.target_id AND area_direct.campaign_id = c.campaign_id
     LEFT JOIN tasks street
       ON c.target_type = 'street-task' AND street.id = c.target_id AND street.campaign_id = c.campaign_id
     LEFT JOIN areas area_street
       ON street.area_id = area_street.id AND street.campaign_id = area_street.campaign_id
     LEFT JOIN house_tasks house
       ON c.target_type = 'house-task' AND house.id = c.target_id AND house.campaign_id = c.campaign_id
     LEFT JOIN areas area_house
       ON house.area_id = area_house.id AND house.campaign_id = area_house.campaign_id
     WHERE c.campaign_id = ?
       AND c.deleted_at IS NULL
       AND c.body IS NOT NULL
       AND c.target_type IN ('campaign', 'area', 'street-task', 'house-task')
       ${scopeSql}
     ORDER BY COALESCE(area_name, ''), c.created_at DESC, c.id DESC
     LIMIT 300`,
  );
  const result = teamId
    ? await statement.bind(campaignId, teamId).all<SummaryRow>()
    : await statement.bind(campaignId).all<SummaryRow>();
  return result.results;
}

function summarySchemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (?:table|column).*?(?:comments|house_tasks|tasks|areas)|(?:comments|house_tasks|tasks|areas).*?does not exist/iu.test(message);
}

export async function handleTeamCommentsSummary(
  request: Request,
  env: TeamCommentsSummaryEnv,
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const campaignId = routeCampaignId(url.pathname);
  if (!campaignId) return null;
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist für diesen Worker nicht gebunden.");

  const access = await resolveAccess(env.DB, request, campaignId);
  if (!access) return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
  const scope = teamCommentScope(access, url.searchParams.get("team"));
  if (!scope.ok) return errorResponse(scope.status, scope.code, "Dieser Kommentarbereich liegt außerhalb deines Team-Scopes.");
  if (scope.teamId && !(await teamExists(env.DB, campaignId, scope.teamId))) {
    return errorResponse(404, "team_not_found", "Team wurde nicht gefunden.");
  }

  try {
    const rows = await loadSummary(env.DB, campaignId, scope.teamId, scope.includeCampaign);
    const groups = new Map<string, {
      areaId: string | null;
      areaName: string;
      comments: Array<{
        id: string;
        targetType: SummaryRow["target_type"];
        targetId: string;
        targetLabel: string;
        body: string;
        authorLabel: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>();

    for (const row of rows) {
      const key = row.area_id ?? "__campaign__";
      const group = groups.get(key) ?? {
        areaId: row.area_id,
        areaName: row.area_name ?? "Allgemein",
        comments: [],
      };
      group.comments.push({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        targetLabel: row.target_label ?? "Kontext",
        body: row.body,
        authorLabel: authorLabel(row.author_kind),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      groups.set(key, group);
    }

    return json({
      scope: scope.teamId ? { kind: "team", teamId: scope.teamId } : { kind: "all", teamId: null },
      groups: [...groups.values()],
    });
  } catch (error) {
    if (summarySchemaUnavailable(error)) {
      return errorResponse(503, "comments_schema_unavailable", "Kommentar-Zusammenfassung benötigt die vorbereiteten Datenbankmigrationen.");
    }
    throw error;
  }
}
