import {
  ACTIVITY_EVENT_TYPES,
  type ActivityActorCategory,
  type ActivityCommentTargetType,
  type ActivityEventType,
  type ActivityItem,
  type ActivityPage,
} from "../src/domain/activity.ts";
import {
  COMPLETE_PARENT_STREET_EFFECT_TYPE,
  COMPLETE_PARENT_STREET_RULE_TYPE,
} from "../src/domain/automations.ts";
import type { TaskStatus } from "../src/domain/campaign.ts";
import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

export { ACTIVITY_EVENT_TYPES as SUPPORTED_ACTIVITY_EVENT_TYPES };

type ActivityRoute = {
  campaignId: string;
};

type ActivityCursor = {
  occurredAt: string;
  id: string;
};

type ActivityRow = {
  id: string;
  event_team_id: string | null;
  event_team_name: string | null;
  field_session_id: string | null;
  entity_type: string;
  entity_id: string;
  event_type: ActivityEventType;
  occurred_at: string;
  actor_kind: string;
  payload_version: number;
  payload_json: string;
  session_team_id: string | null;
  session_team_name: string | null;
  duration_seconds: number | null;
  participant_count: number | null;
  person_seconds: number | null;
  street_task_label: string | null;
  street_area_label: string | null;
  house_task_label: string | null;
  house_area_label: string | null;
  comment_target_type: string | null;
  comment_target_id: string | null;
  comment_campaign_label: string | null;
  comment_area_label: string | null;
  comment_street_label: string | null;
  comment_street_area_label: string | null;
  comment_house_label: string | null;
  comment_house_area_label: string | null;
};

type SchemaTable = "domain_events" | "field_sessions" | "comments" | "house_tasks";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_CURSOR_LENGTH = 512;
const TABLE_INFO_QUERIES: Record<SchemaTable, string> = {
  domain_events: "PRAGMA table_info(domain_events)",
  field_sessions: "PRAGMA table_info(field_sessions)",
  comments: "PRAGMA table_info(comments)",
  house_tasks: "PRAGMA table_info(house_tasks)",
};

const REQUIRED_EVENT_COLUMNS = [
  "id",
  "campaign_id",
  "team_id",
  "field_session_id",
  "entity_type",
  "entity_id",
  "event_type",
  "occurred_at",
  "actor_kind",
  "payload_version",
  "payload_json",
  "dedupe_key",
] as const;

const REQUIRED_SESSION_COLUMNS = [
  "id",
  "campaign_id",
  "team_id",
  "field_group_id",
  "mode",
  "started_at",
  "ended_at",
  "duration_seconds",
  "participant_count",
  "person_seconds",
  "status",
] as const;

const OPTIONAL_COMMENT_COLUMNS = ["id", "campaign_id", "target_type", "target_id"] as const;
const OPTIONAL_HOUSE_COLUMNS = ["id", "campaign_id", "area_id", "label"] as const;

const TASK_STATUSES = new Set<TaskStatus>([
  "open",
  "completed",
  "later",
  "not-deliverable",
]);

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

function validSelector(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function safeId(value: string | null | undefined) {
  return validSelector(value) ? value : null;
}

function safeLabel(value: string | null | undefined, fallback: string) {
  const label = typeof value === "string" ? value.trim().slice(0, 160) : "";
  return label || fallback;
}

function optionalLabel(value: string | null | undefined) {
  const label = typeof value === "string" ? value.trim().slice(0, 160) : "";
  return label || null;
}

function safeInteger(value: unknown, maximum?: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  if (maximum !== undefined && value > maximum) return null;
  return value;
}

function actorCategory(actorKind: string): ActivityActorCategory {
  if (actorKind === "temporary-member") return "temporary-group";
  if (actorKind === "campaign-grant" || actorKind === "organization-account") {
    return "campaign-access";
  }
  if (actorKind === "system") return "system";
  return "unknown";
}

function isActivityEventType(value: string): value is ActivityEventType {
  return (ACTIVITY_EVENT_TYPES as readonly string[]).includes(value);
}

function parseTaskStatus(value: unknown): TaskStatus | null {
  return typeof value === "string" && TASK_STATUSES.has(value as TaskStatus)
    ? (value as TaskStatus)
    : null;
}

function parseTaskStatuses(row: ActivityRow) {
  if (row.payload_version !== 1) {
    return { previousStatus: null, newStatus: null };
  }
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { previousStatus: null, newStatus: null };
    }
    const record = payload as Record<string, unknown>;
    return {
      previousStatus: parseTaskStatus(record.previousStatus),
      newStatus: parseTaskStatus(record.newStatus),
    };
  } catch {
    return { previousStatus: null, newStatus: null };
  }
}

function commentTargetType(value: string | null): ActivityCommentTargetType {
  if (
    value === "campaign" ||
    value === "area" ||
    value === "street-task" ||
    value === "house-task"
  ) {
    return value;
  }
  return "context";
}

function projectTask(row: ActivityRow): ActivityItem {
  const taskType =
    row.entity_type === "street-task"
      ? "street"
      : row.entity_type === "house-task"
        ? "house"
        : "unknown";
  const targetLabel =
    taskType === "street"
      ? safeLabel(row.street_task_label, "Straße")
      : taskType === "house"
        ? safeLabel(row.house_task_label, "Haus")
        : "Aufgabe";
  const contextLabel =
    taskType === "street"
      ? optionalLabel(row.street_area_label)
      : taskType === "house"
        ? optionalLabel(row.house_area_label)
        : null;
  const statuses = parseTaskStatuses(row);
  return {
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    teamId: safeId(row.event_team_id ?? row.session_team_id),
    teamLabel: optionalLabel(row.event_team_name ?? row.session_team_name),
    fieldSessionId: safeId(row.field_session_id),
    entityType:
      taskType === "street"
        ? "street-task"
        : taskType === "house"
          ? "house-task"
          : "unknown",
    entityId: safeId(row.entity_id),
    actorCategory: actorCategory(row.actor_kind),
    details: {
      kind: "task-status-changed",
      taskType,
      targetLabel,
      contextLabel,
      ...statuses,
    },
  };
}

function projectFieldSession(row: ActivityRow): ActivityItem {
  const expired = row.event_type === "field_session.expired";
  return {
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    teamId: safeId(row.event_team_id ?? row.session_team_id),
    teamLabel: optionalLabel(row.event_team_name ?? row.session_team_name),
    fieldSessionId: safeId(row.field_session_id ?? row.entity_id),
    entityType: "field-session",
    entityId: safeId(row.entity_id),
    actorCategory: actorCategory(row.actor_kind),
    details: {
      kind: expired ? "field-session-expired" : "field-session-closed",
      durationSeconds: safeInteger(row.duration_seconds),
      participantCount: safeInteger(row.participant_count, 500),
      personSeconds: safeInteger(row.person_seconds),
    },
  };
}

function projectAutomation(row: ActivityRow): ActivityItem | null {
  if (row.entity_type !== "street-task" || row.actor_kind !== "system") return null;
  if (row.payload_version !== 1) return null;
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    if (
      record.ruleType !== COMPLETE_PARENT_STREET_RULE_TYPE ||
      record.effectType !== COMPLETE_PARENT_STREET_EFFECT_TYPE
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    teamId: safeId(row.event_team_id ?? row.session_team_id),
    teamLabel: optionalLabel(row.event_team_name ?? row.session_team_name),
    fieldSessionId: safeId(row.field_session_id),
    entityType: "street-task",
    entityId: safeId(row.entity_id),
    actorCategory: actorCategory(row.actor_kind),
    details: {
      kind: "automation-executed",
      targetLabel: safeLabel(row.street_task_label, "Straße"),
      contextLabel: optionalLabel(row.street_area_label),
    },
  };
}

function projectComment(row: ActivityRow): ActivityItem {
  const targetType = commentTargetType(row.comment_target_type);
  const targetId = safeId(row.comment_target_id);
  const targetLabel =
    targetType === "campaign"
      ? safeLabel(row.comment_campaign_label, "Campaign")
      : targetType === "area"
        ? safeLabel(row.comment_area_label, "Gebiet")
        : targetType === "street-task"
          ? safeLabel(row.comment_street_label, "Straße")
          : targetType === "house-task"
            ? safeLabel(row.comment_house_label, "Haus")
            : "Kommentar-Kontext";
  const contextLabel =
    targetType === "street-task"
      ? optionalLabel(row.comment_street_area_label)
      : targetType === "house-task"
        ? optionalLabel(row.comment_house_area_label)
        : null;
  const kind =
    row.event_type === "comment.created"
      ? "comment-created"
      : row.event_type === "comment.edited"
        ? "comment-edited"
        : "comment-deleted";
  return {
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    teamId: safeId(row.event_team_id ?? row.session_team_id),
    teamLabel: optionalLabel(row.event_team_name ?? row.session_team_name),
    fieldSessionId: safeId(row.field_session_id),
    entityType: "comment",
    entityId: safeId(row.entity_id),
    actorCategory: actorCategory(row.actor_kind),
    details: {
      kind,
      targetType,
      targetId,
      targetLabel,
      contextLabel,
    },
  };
}

function projectRow(row: ActivityRow): ActivityItem | null {
  if (!isActivityEventType(row.event_type) || !validSelector(row.id)) return null;
  if (row.event_type === "task.status.changed") return projectTask(row);
  if (row.event_type === "field_session.closed" || row.event_type === "field_session.expired") {
    return projectFieldSession(row);
  }
  if (row.event_type === "automation.executed") return projectAutomation(row);
  return projectComment(row);
}

async function hasColumns(
  db: D1DatabaseLike,
  table: SchemaTable,
  required: readonly string[],
) {
  try {
    const result = await db.prepare(TABLE_INFO_QUERIES[table]).all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return required.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

async function hasActivitySchema(db: D1DatabaseLike) {
  const [events, sessions] = await Promise.all([
    hasColumns(db, "domain_events", REQUIRED_EVENT_COLUMNS),
    hasColumns(db, "field_sessions", REQUIRED_SESSION_COLUMNS),
  ]);
  return events && sessions;
}

function parseLimit(value: string | null) {
  if (value === null || value === "") return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : null;
}

function encodeCursor(cursor: ActivityCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCursor(value: string | null): ActivityCursor | null {
  if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (
      typeof parsed.occurredAt !== "string" ||
      parsed.occurredAt.length > 64 ||
      !Number.isFinite(Date.parse(parsed.occurredAt)) ||
      !validSelector(parsed.id)
    ) {
      return null;
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function parseActivityRoute(pathname: string): ActivityRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/activity$/u);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    return campaignId ? { campaignId } : null;
  } catch {
    return null;
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function scopeWhere(
  access: AccessContext,
  campaignId: string,
  requestedTeamId: string | null,
) {
  const where = [
    "e.campaign_id = ?",
    `e.event_type IN (${ACTIVITY_EVENT_TYPES.map(() => "?").join(", ")})`,
  ];
  const bindings: unknown[] = [campaignId, ...ACTIVITY_EVENT_TYPES];

  if (access.role === "admin" || access.role === "viewer") {
    if (requestedTeamId) {
      where.push("e.team_id = ?");
      bindings.push(requestedTeamId);
    }
    return { where, bindings };
  }

  if (access.role === "team-editor") {
    if (!access.teamId) return null;
    where.push("e.team_id = ?");
    bindings.push(access.teamId);
    return { where, bindings };
  }

  if (access.role !== "field-group-member" || !access.teamId || !access.groupId || !access.membershipId) {
    return null;
  }
  where.push(`(
    (
      e.team_id = ?
      AND e.field_session_id IS NOT NULL
      AND fs.campaign_id = ?
      AND fs.team_id = ?
      AND fs.field_group_id = ?
    )
    OR (
      e.event_type IN (?, ?, ?)
      AND e.team_id = ?
      AND e.field_session_id IS NULL
      AND e.actor_kind = 'temporary-member'
      AND e.actor_ref = ?
    )
  )`);
  bindings.push(
    access.teamId,
    campaignId,
    access.teamId,
    access.groupId,
    "comment.created",
    "comment.edited",
    "comment.deleted",
    access.teamId,
    access.membershipId,
  );
  return { where, bindings };
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*(?:domain_events|field_sessions|comments|house_tasks)|(?:domain_events|field_sessions|comments|house_tasks).*does not exist|no such column.*(?:domain_events|field_sessions|comments|house_tasks)/iu.test(
    message,
  );
}

async function listActivity(
  request: Request,
  db: D1DatabaseLike,
  route: ActivityRoute,
  access: AccessContext,
) {
  const url = new URL(request.url);
  const rawTeamId = url.searchParams.get("team");
  const requestedTeamId = rawTeamId === null || rawTeamId === "" ? null : rawTeamId;
  if (requestedTeamId && !validSelector(requestedTeamId)) {
    return errorResponse(400, "invalid_team_filter", "Team-Filter ist ungültig.");
  }

  if (
    (access.role === "team-editor" || access.role === "field-group-member") &&
    requestedTeamId &&
    requestedTeamId !== access.teamId
  ) {
    return errorResponse(403, "activity_scope_forbidden", "Dieses Team liegt außerhalb deines Zugriffs.");
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === null) {
    return errorResponse(400, "invalid_limit", `limit muss zwischen 1 und ${MAX_LIMIT} liegen.`);
  }
  const cursorValue = url.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return errorResponse(400, "invalid_cursor", "Activity-Cursor ist ungültig.");
  }

  const scope = scopeWhere(access, route.campaignId, requestedTeamId);
  if (!scope) {
    return errorResponse(403, "activity_scope_missing", "Activity-Scope ist nicht vollständig autorisiert.");
  }
  if (cursor) {
    scope.where.push("(e.occurred_at < ? OR (e.occurred_at = ? AND e.id < ?))");
    scope.bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }

  const [hasComments, hasHouseTasks] = await Promise.all([
    hasColumns(db, "comments", OPTIONAL_COMMENT_COLUMNS),
    hasColumns(db, "house_tasks", OPTIONAL_HOUSE_COLUMNS),
  ]);
  const houseProjection = hasHouseTasks
    ? `
           ht.label AS house_task_label,
           ha.name AS house_area_label,`
    : `
           NULL AS house_task_label,
           NULL AS house_area_label,`;
  const houseJoins = hasHouseTasks
    ? `
         LEFT JOIN house_tasks ht
           ON e.entity_type = 'house-task'
          AND ht.id = e.entity_id
          AND ht.campaign_id = e.campaign_id
         LEFT JOIN areas ha
           ON ha.id = ht.area_id
          AND ha.campaign_id = ht.campaign_id`
    : "";
  const commentProjection = hasComments
    ? `
           c.target_type AS comment_target_type,
           c.target_id AS comment_target_id,
           comment_campaign.name AS comment_campaign_label,
           comment_area.name AS comment_area_label,
           comment_street.label AS comment_street_label,
           comment_street_area.name AS comment_street_area_label,
           comment_house.label AS comment_house_label,
           comment_house_area.name AS comment_house_area_label`
    : `
           NULL AS comment_target_type,
           NULL AS comment_target_id,
           NULL AS comment_campaign_label,
           NULL AS comment_area_label,
           NULL AS comment_street_label,
           NULL AS comment_street_area_label,
           NULL AS comment_house_label,
           NULL AS comment_house_area_label`;
  const commentJoins = hasComments
    ? `
         LEFT JOIN comments c
           ON e.entity_type = 'comment'
          AND c.id = e.entity_id
          AND c.campaign_id = e.campaign_id
         LEFT JOIN campaigns comment_campaign
           ON c.target_type = 'campaign'
          AND comment_campaign.id = c.target_id
          AND comment_campaign.id = c.campaign_id
         LEFT JOIN areas comment_area
           ON c.target_type = 'area'
          AND comment_area.id = c.target_id
          AND comment_area.campaign_id = c.campaign_id
         LEFT JOIN tasks comment_street
           ON c.target_type = 'street-task'
          AND comment_street.id = c.target_id
          AND comment_street.campaign_id = c.campaign_id
         LEFT JOIN areas comment_street_area
           ON comment_street_area.id = comment_street.area_id
          AND comment_street_area.campaign_id = comment_street.campaign_id${
            hasHouseTasks
              ? `
         LEFT JOIN house_tasks comment_house
           ON c.target_type = 'house-task'
          AND comment_house.id = c.target_id
          AND comment_house.campaign_id = c.campaign_id
         LEFT JOIN areas comment_house_area
           ON comment_house_area.id = comment_house.area_id
          AND comment_house_area.campaign_id = comment_house.campaign_id`
              : ""
          }`
    : "";

  const result = await db
    .prepare(
      `SELECT
           e.id,
           e.team_id AS event_team_id,
           event_team.name AS event_team_name,
           e.field_session_id,
           e.entity_type,
           e.entity_id,
           e.event_type,
           e.occurred_at,
           e.actor_kind,
           e.payload_version,
           e.payload_json,
           fs.team_id AS session_team_id,
           session_team.name AS session_team_name,
           fs.duration_seconds,
           fs.participant_count,
           fs.person_seconds,
           street_task.label AS street_task_label,
           street_area.name AS street_area_label,${houseProjection}${commentProjection}
         FROM domain_events e
         LEFT JOIN teams event_team
           ON event_team.id = e.team_id
          AND event_team.campaign_id = e.campaign_id
         LEFT JOIN field_sessions fs
           ON fs.id = e.field_session_id
          AND fs.campaign_id = e.campaign_id
         LEFT JOIN teams session_team
           ON session_team.id = fs.team_id
          AND session_team.campaign_id = fs.campaign_id
         LEFT JOIN tasks street_task
           ON e.entity_type = 'street-task'
          AND street_task.id = e.entity_id
          AND street_task.campaign_id = e.campaign_id
         LEFT JOIN areas street_area
           ON street_area.id = street_task.area_id
          AND street_area.campaign_id = street_task.campaign_id${houseJoins}${commentJoins}
         WHERE ${scope.where.join("\n           AND ")}
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT ?`,
    )
    .bind(...scope.bindings, limit + 1)
    .all<ActivityRow>();

  const hasMore = result.results.length > limit;
  const rows = hasMore ? result.results.slice(0, limit) : result.results;
  const items = rows.map(projectRow).filter((item): item is ActivityItem => item !== null);
  const last = rows.at(-1) ?? null;
  return json({
    activities: items,
    nextCursor: hasMore && last ? encodeCursor({ occurredAt: last.occurred_at, id: last.id }) : null,
  } satisfies ActivityPage);
}

export async function handleActivityApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseActivityRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "GET") {
    if (!sameOrigin(request)) {
      return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
    }
    return errorResponse(405, "method_not_allowed", "Für Activity ist nur GET erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    if (!(await hasActivitySchema(db))) {
      return errorResponse(
        503,
        "activity_schema_unavailable",
        "Activity ist serverseitig vorbereitet, aber die Field-Session-/Event-Migration ist noch nicht angewendet.",
      );
    }
    return await listActivity(request, db, route, access);
  } catch (error) {
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "activity_schema_unavailable",
        "Activity ist serverseitig vorbereitet, aber die Field-Session-/Event-Migration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "activity_failed", "Activity konnte nicht geladen werden.");
  }
}
