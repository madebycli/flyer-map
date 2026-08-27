import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 320;

type FieldSessionRoute = {
  campaignId: string;
};

type FieldSessionRow = {
  id: string;
  campaign_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
  field_group_id: string | null;
  mode: "distribution" | "collection";
  started_at: string;
  ended_at: string | null;
  end_reason: "manual-close" | "group-expired" | null;
  duration_seconds: number | null;
  participant_count: number | null;
  person_seconds: number | null;
  status: "active" | "closed";
};

type Cursor = {
  startedAt: string;
  id: string;
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

export function parseFieldSessionsRoute(pathname: string): FieldSessionRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/field-sessions$/u);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    return campaignId ? { campaignId } : null;
  } catch {
    return null;
  }
}

function parseLimit(value: string | null) {
  if (value === null || value === "") return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function parseCursor(value: string | null): Cursor | null | "invalid" {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) return "invalid";
  const separator = value.lastIndexOf("|");
  if (separator <= 0 || separator === value.length - 1) return "invalid";
  const startedAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (Number.isNaN(Date.parse(startedAt)) || !validSelector(id)) return "invalid";
  return { startedAt, id };
}

function cursorFor(row: FieldSessionRow) {
  return `${row.started_at}|${row.id}`;
}

function teamFilterForAccess(
  access: AccessContext,
  requestedTeamId: string | null,
): { ok: true; teamId: string | null; groupId: string | null } | { ok: false; response: Response } {
  if (access.role === "field-group-member") {
    if (!access.teamId || !access.groupId) {
      return {
        ok: false,
        response: errorResponse(403, "field_session_scope_missing", "Temporärer Einsatz-Scope fehlt."),
      };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return {
        ok: false,
        response: errorResponse(403, "field_session_scope_forbidden", "Dieses Team liegt außerhalb deines Zugriffs."),
      };
    }
    return { ok: true, teamId: access.teamId, groupId: access.groupId };
  }

  if (access.role === "team-editor") {
    if (!access.teamId) {
      return {
        ok: false,
        response: errorResponse(403, "field_session_scope_missing", "Team-Scope fehlt."),
      };
    }
    if (requestedTeamId && requestedTeamId !== access.teamId) {
      return {
        ok: false,
        response: errorResponse(403, "field_session_scope_forbidden", "Dieses Team liegt außerhalb deines Zugriffs."),
      };
    }
    return { ok: true, teamId: access.teamId, groupId: null };
  }

  return { ok: true, teamId: requestedTeamId, groupId: null };
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*field_sessions|field_sessions.*does not exist/iu.test(message);
}

export async function handleFieldSessionsApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseFieldSessionsRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Für Einsatzhistorie ist nur GET erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) {
      return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    }

    const url = new URL(request.url);
    const rawTeamId = url.searchParams.get("team");
    const requestedTeamId = rawTeamId === null || rawTeamId === "" ? null : rawTeamId;
    if (requestedTeamId && !validSelector(requestedTeamId)) {
      return errorResponse(400, "invalid_team_filter", "Team-Filter ist ungültig.");
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    if (limit === null) {
      return errorResponse(400, "invalid_limit", `limit muss zwischen 1 und ${MAX_LIMIT} liegen.`);
    }

    const cursor = parseCursor(url.searchParams.get("cursor"));
    if (cursor === "invalid") {
      return errorResponse(400, "invalid_cursor", "History-Cursor ist ungültig.");
    }

    const scope = teamFilterForAccess(access, requestedTeamId);
    if (!scope.ok) return scope.response;

    const result = await db
      .prepare(
        `SELECT
           s.id,
           s.campaign_id,
           s.team_id,
           t.name AS team_name,
           t.color AS team_color,
           s.field_group_id,
           s.mode,
           s.started_at,
           s.ended_at,
           s.end_reason,
           s.duration_seconds,
           s.participant_count,
           s.person_seconds,
           s.status
         FROM field_sessions s
         JOIN teams t ON t.id = s.team_id AND t.campaign_id = s.campaign_id
         WHERE s.campaign_id = ?
           AND (? IS NULL OR s.team_id = ?)
           AND (? IS NULL OR s.field_group_id = ?)
           AND (
             ? IS NULL OR
             s.started_at < ? OR
             (s.started_at = ? AND s.id < ?)
           )
         ORDER BY s.started_at DESC, s.id DESC
         LIMIT ?`,
      )
      .bind(
        route.campaignId,
        scope.teamId,
        scope.teamId,
        scope.groupId,
        scope.groupId,
        cursor?.startedAt ?? null,
        cursor?.startedAt ?? null,
        cursor?.startedAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      )
      .all<FieldSessionRow>();

    const hasMore = result.results.length > limit;
    const rows = hasMore ? result.results.slice(0, limit) : result.results;
    const last = rows.at(-1) ?? null;

    return json({
      sessions: rows.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        teamId: row.team_id,
        teamName: row.team_name,
        teamColor: row.team_color,
        fieldGroupId: row.field_group_id,
        mode: row.mode,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        endReason: row.end_reason,
        durationSeconds: row.duration_seconds,
        participantCount: row.participant_count,
        personSeconds: row.person_seconds,
        status: row.status,
      })),
      nextCursor: hasMore && last ? cursorFor(last) : null,
    });
  } catch (error) {
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "field_session_schema_unavailable",
        "Field-Session-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "field_session_history_failed", "Einsatzhistorie konnte nicht geladen werden.");
  }
}
