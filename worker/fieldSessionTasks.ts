import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_CURSOR_LENGTH = 420;

type FieldSessionTasksRoute = {
  campaignId: string;
  sessionId: string;
};

type SessionScopeRow = {
  id: string;
  team_id: string;
  field_group_id: string | null;
};

type TaskRefRow = {
  entity_type: "street-task" | "house-task";
  entity_id: string;
};

type TaskCursor = {
  entityType: "street-task" | "house-task";
  entityId: string;
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

export function parseFieldSessionTasksRoute(pathname: string): FieldSessionTasksRoute | null {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/field-sessions\/([^/]+)\/tasks$/u,
  );
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const sessionId = decodeURIComponent(match[2]);
    if (!campaignId || !validSelector(sessionId)) return null;
    return { campaignId, sessionId };
  } catch {
    return null;
  }
}

function parseLimit(value: string | null) {
  if (value === null || value === "") return DEFAULT_LIMIT;
  if (!/^\d{1,4}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function parseCursor(value: string | null): TaskCursor | null | "invalid" {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) return "invalid";
  const separator = value.indexOf("|");
  if (separator <= 0 || separator === value.length - 1) return "invalid";
  const entityType = value.slice(0, separator);
  const entityId = value.slice(separator + 1);
  if (
    (entityType !== "street-task" && entityType !== "house-task") ||
    !validSelector(entityId)
  ) {
    return "invalid";
  }
  return { entityType, entityId };
}

function cursorFor(row: TaskRefRow) {
  return `${row.entity_type}|${row.entity_id}`;
}

function canReadSession(access: AccessContext, session: SessionScopeRow) {
  if (access.role === "field-group-member") {
    return Boolean(
      access.teamId &&
        access.groupId &&
        session.team_id === access.teamId &&
        session.field_group_id === access.groupId,
    );
  }
  if (access.role === "team-editor") {
    return Boolean(access.teamId && session.team_id === access.teamId);
  }
  return true;
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*field_sessions|field_sessions.*does not exist|no such table.*domain_events|domain_events.*does not exist/iu.test(
    message,
  );
}

export async function handleFieldSessionTasksApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseFieldSessionTasksRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Für Einsatz-Aufgaben ist nur GET erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) {
      return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    }

    const session = await db
      .prepare(
        `SELECT id, team_id, field_group_id
         FROM field_sessions
         WHERE id = ? AND campaign_id = ?
         LIMIT 1`,
      )
      .bind(route.sessionId, route.campaignId)
      .first<SessionScopeRow>();
    if (!session) {
      return errorResponse(404, "field_session_not_found", "Einsatz wurde nicht gefunden.");
    }
    if (!canReadSession(access, session)) {
      return errorResponse(
        403,
        "field_session_scope_forbidden",
        "Dieser Einsatz liegt außerhalb deines Zugriffs.",
      );
    }

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    if (limit === null) {
      return errorResponse(400, "invalid_limit", `limit muss zwischen 1 und ${MAX_LIMIT} liegen.`);
    }
    const cursor = parseCursor(url.searchParams.get("cursor"));
    if (cursor === "invalid") {
      return errorResponse(400, "invalid_cursor", "Task-Cursor ist ungültig.");
    }

    const result = await db
      .prepare(
        `SELECT DISTINCT entity_type, entity_id
         FROM domain_events
         WHERE campaign_id = ?
           AND field_session_id = ?
           AND event_type = 'task.status.changed'
           AND entity_type IN ('street-task', 'house-task')
           AND (
             ? IS NULL OR
             entity_type > ? OR
             (entity_type = ? AND entity_id > ?)
           )
         ORDER BY entity_type, entity_id
         LIMIT ?`,
      )
      .bind(
        route.campaignId,
        route.sessionId,
        cursor?.entityType ?? null,
        cursor?.entityType ?? null,
        cursor?.entityType ?? null,
        cursor?.entityId ?? null,
        limit + 1,
      )
      .all<TaskRefRow>();

    const hasMore = result.results.length > limit;
    const rows = hasMore ? result.results.slice(0, limit) : result.results;
    const last = rows.at(-1) ?? null;

    return json({
      taskRefs: rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
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
    return errorResponse(500, "field_session_tasks_failed", "Einsatz-Aufgaben konnten nicht geladen werden.");
  }
}
