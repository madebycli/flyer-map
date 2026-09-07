import {
  COMMENT_BODY_MAX_LENGTH,
  isValidCommentIdentifier,
  normalizeCommentBody,
  normalizeCommentTargetType,
  type PersistentCommentTargetType,
} from "../src/domain/commentDraft.ts";
import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { resolveCollectionAccess } from "./collectionAccess.ts";
import { loadPickupCapabilities } from "./pickupCapabilities.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const MAX_COMMENT_REQUEST_BYTES = 64_000;
const DEFAULT_COMMENT_PAGE_SIZE = 20;
const MAX_COMMENT_PAGE_SIZE = 50;
const PICKUP_COMMENTS_SCHEMA_ERROR = "pickup_comments_schema_unavailable";

type CommentRoute = {
  campaignId: string;
  commentId: string | null;
};

type CommentTarget = {
  id: string;
  teamId: string | null;
  archivedAt?: string | null;
};

type StoredComment = {
  id: string;
  campaign_id: string;
  target_type: PersistentCommentTargetType;
  target_id: string;
  team_id: string | null;
  author_kind: "campaign-grant" | "temporary-member" | "collection-collector" | "unknown";
  author_ref: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  last_operation_id: string | null;
};

export type CommentListItem = {
  id: string;
  targetType: PersistentCommentTargetType;
  targetId: string;
  body: string | null;
  authorLabel: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deleted: boolean;
  version: number;
  canEdit: boolean;
  canDelete: boolean;
};

type CommentPageCursor = {
  createdAt: string;
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

function validSelector(value: unknown): value is string {
  return isValidCommentIdentifier(value);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
}

export function parseCommentsRoute(pathname: string): CommentRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/comments(?:\/([^/]+))?$/u);
  if (!match) return null;

  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const commentId = match[2] ? decodeURIComponent(match[2]) : null;
    if (!campaignId || (commentId !== null && !validSelector(commentId))) return null;
    return { campaignId, commentId };
  } catch {
    return null;
  }
}

function parseTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const targetType = normalizeCommentTargetType(record.targetType);
  const targetId = record.targetId;
  if (!targetType || !validSelector(targetId)) return null;
  return { targetType, targetId };
}

function parsePageSize(value: string | null) {
  if (value === null || value === "") return DEFAULT_COMMENT_PAGE_SIZE;
  if (!/^\d{1,3}$/u.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= MAX_COMMENT_PAGE_SIZE ? limit : null;
}

function encodeCursor(cursor: CommentPageCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCursor(value: string | null): CommentPageCursor | null {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (
      typeof parsed.createdAt !== "string" ||
      parsed.createdAt.length > 64 ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      !validSelector(parsed.id)
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id as string };
  } catch {
    return null;
  }
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMENT_REQUEST_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "request_too_large", "Kommentar-Anfrage ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_COMMENT_REQUEST_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "request_too_large", "Kommentar-Anfrage ist zu groß."),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Kommentar-Anfrage ist ungültig."),
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_comment", "Kommentar-Anfrage ist ungültig."),
    };
  }
  return { ok: true as const, value: parsed as Record<string, unknown> };
}

async function readOptionalJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMENT_REQUEST_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "request_too_large", "Kommentar-Anfrage ist zu groß."),
    };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_COMMENT_REQUEST_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "request_too_large", "Kommentar-Anfrage ist zu groß."),
    };
  }
  if (!raw.trim()) return { ok: true as const, value: {} as Record<string, unknown> };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_comment", "Kommentar-Anfrage ist ungültig."),
      };
    }
    return { ok: true as const, value: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Kommentar-Anfrage ist ungültig."),
    };
  }
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*(?:comments|domain_events)|(?:comments|domain_events).*does not exist|no such column.*(?:comments|domain_events)/iu.test(
    message,
  );
}

async function hasRequiredColumns(
  db: D1DatabaseLike,
  table: "comments" | "domain_events",
  required: readonly string[],
) {
  const query = table === "comments" ? "PRAGMA table_info(comments)" : "PRAGMA table_info(domain_events)";
  try {
    const result = await db.prepare(query).all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return required.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

async function hasCommentsSchema(db: D1DatabaseLike) {
  const [comments, events] = await Promise.all([
    hasRequiredColumns(db, "comments", [
      "id",
      "campaign_id",
      "target_type",
      "target_id",
      "team_id",
      "author_kind",
      "author_ref",
      "body",
      "created_at",
      "updated_at",
      "deleted_at",
      "version",
      "last_operation_id",
    ]),
    hasRequiredColumns(db, "domain_events", [
      "id",
      "campaign_id",
      "team_id",
      "field_session_id",
      "entity_type",
      "entity_id",
      "event_type",
      "occurred_at",
      "actor_kind",
      "actor_ref",
      "payload_version",
      "payload_json",
      "dedupe_key",
      "created_at",
    ]),
  ]);
  return comments && events;
}

async function tableDefinition(db: D1DatabaseLike, table: "comments" | "domain_events") {
  try {
    return await db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(table)
      .first<{ sql: string | null }>();
  } catch {
    return null;
  }
}

async function hasPickupCommentsSchema(db: D1DatabaseLike) {
  const [comments, events] = await Promise.all([
    tableDefinition(db, "comments"),
    tableDefinition(db, "domain_events"),
  ]);
  return Boolean(
    comments?.sql?.includes("'pickup-task'") &&
      comments.sql.includes("'collection-collector'") &&
      events?.sql?.includes("'collection-collector'"),
  );
}

function pickupCommentsSchemaError() {
  return new Error(PICKUP_COMMENTS_SCHEMA_ERROR);
}

async function resolveTarget(
  db: D1DatabaseLike,
  campaignId: string,
  targetType: PersistentCommentTargetType,
  targetId: string,
): Promise<CommentTarget | null> {
  if (targetType === "campaign") {
    const row = await db
      .prepare(
        "SELECT id AS target_id, NULL AS team_id FROM campaigns WHERE id = ? AND id = ? LIMIT 1",
      )
      .bind(targetId, campaignId)
      .first<{ target_id: string; team_id: null }>();
    return row ? { id: row.target_id, teamId: null } : null;
  }

  if (targetType === "area") {
    const row = await db
      .prepare(
        `SELECT id AS target_id, team_id
         FROM areas
         WHERE id = ? AND campaign_id = ?
         LIMIT 1`,
      )
      .bind(targetId, campaignId)
      .first<{ target_id: string; team_id: string }>();
    return row ? { id: row.target_id, teamId: row.team_id } : null;
  }

  if (targetType === "street-task") {
    const row = await db
      .prepare(
        `SELECT t.id AS target_id, a.team_id
         FROM tasks t
         JOIN areas a ON a.id = t.area_id AND a.campaign_id = t.campaign_id
         WHERE t.id = ? AND t.campaign_id = ?
         LIMIT 1`,
      )
      .bind(targetId, campaignId)
      .first<{ target_id: string; team_id: string }>();
    return row ? { id: row.target_id, teamId: row.team_id } : null;
  }

  if (targetType === "house-task") {
    try {
      const row = await db
        .prepare(
          `SELECT h.id AS target_id, a.team_id
           FROM house_tasks h
           JOIN areas a ON a.id = h.area_id AND a.campaign_id = h.campaign_id
           WHERE h.id = ? AND h.campaign_id = ?
           LIMIT 1`,
        )
        .bind(targetId, campaignId)
        .first<{ target_id: string; team_id: string }>();
      return row ? { id: row.target_id, teamId: row.team_id } : null;
    } catch (error) {
      if (/no such table.*house_tasks|house_tasks.*does not exist/iu.test(String(error))) return null;
      throw error;
    }
  }

  if (!(await hasPickupCommentsSchema(db))) throw pickupCommentsSchemaError();
  try {
    const row = await db
      .prepare(
        `SELECT id AS target_id, archived_at
         FROM collection_pickups
         WHERE id = ? AND campaign_id = ?
         LIMIT 1`,
      )
      .bind(targetId, campaignId)
      .first<{ target_id: string; archived_at: string | null }>();
    return row
      ? { id: row.target_id, teamId: null, archivedAt: row.archived_at }
      : null;
  } catch (error) {
    if (/no such table.*collection_pickups|collection_pickups.*does not exist/iu.test(String(error))) {
      throw pickupCommentsSchemaError();
    }
    throw error;
  }
}

function canReadTarget(access: AccessContext, targetType: PersistentCommentTargetType, target: CommentTarget) {
  if (access.role === "collection-collector") return false;
  if (targetType === "campaign" || access.role === "admin" || access.role === "viewer") return true;
  return Boolean(access.teamId && target.teamId && access.teamId === target.teamId);
}

async function canReadCommentTarget(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  targetType: PersistentCommentTargetType,
  target: CommentTarget,
) {
  if (targetType !== "pickup-task") return canReadTarget(access, targetType, target);
  if (access.role === "admin") return true;
  if (
    access.role !== "collection-collector" ||
    !access.collectorId ||
    target.archivedAt !== null
  ) {
    return false;
  }
  const capabilities = await loadPickupCapabilities(db, campaignId, access.collectorId);
  return Boolean(capabilities?.canViewPickups);
}

function canCreateComment(
  access: AccessContext,
  targetType: PersistentCommentTargetType,
  target: CommentTarget,
) {
  if (access.role === "admin") return true;
  if (targetType === "pickup-task") {
    return access.role === "collection-collector" && Boolean(access.collectorId);
  }
  if (targetType === "campaign" || !target.teamId || !access.teamId) return false;
  if (access.teamId !== target.teamId) return false;
  if (access.role === "team-editor") return true;
  return access.role === "field-group-member" && Boolean(access.groupId && access.membershipId);
}

function canModerateComment(
  access: AccessContext,
  targetType: PersistentCommentTargetType,
  target: CommentTarget,
) {
  if (access.role === "admin") return true;
  if (targetType === "pickup-task") return false;
  return (
    access.role === "team-editor" &&
    targetType !== "campaign" &&
    Boolean(access.teamId && target.teamId && access.teamId === target.teamId)
  );
}

function authorFor(access: AccessContext) {
  if (access.role === "field-group-member") {
    return { kind: "temporary-member" as const, ref: access.membershipId ?? null };
  }
  if (access.role === "collection-collector") {
    return { kind: "collection-collector" as const, ref: access.collectorId ?? null };
  }
  return { kind: "campaign-grant" as const, ref: access.grantId };
}

function authorLabel(kind: StoredComment["author_kind"]) {
  if (kind === "temporary-member") return "Temporäre Gruppe";
  if (kind === "collection-collector") return "Collection-Helfer";
  if (kind === "campaign-grant") return "Campaign-Zugriff";
  return "Unbekannter Zugriff";
}

function publicComment(
  comment: StoredComment,
  access: AccessContext,
  target: CommentTarget,
): CommentListItem {
  const deleted = Boolean(comment.deleted_at);
  const canModerate = !deleted && canModerateComment(access, comment.target_type, target);
  return {
    id: comment.id,
    targetType: comment.target_type,
    targetId: comment.target_id,
    body: deleted ? null : comment.body,
    authorLabel: authorLabel(comment.author_kind),
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    deletedAt: comment.deleted_at,
    deleted,
    version: comment.version,
    canEdit: canModerate,
    canDelete: canModerate,
  };
}

async function getComment(db: D1DatabaseLike, campaignId: string, commentId: string) {
  return db
    .prepare(
      `SELECT id, campaign_id, target_type, target_id, team_id,
              author_kind, author_ref, body, created_at, updated_at,
              deleted_at, version, last_operation_id
       FROM comments
       WHERE id = ? AND campaign_id = ?
       LIMIT 1`,
    )
    .bind(commentId, campaignId)
    .first<StoredComment>();
}

function eventPayload(version: number) {
  return JSON.stringify({ version });
}

function commentEventStatement(
  db: D1DatabaseLike,
  input: {
    eventId: string;
    campaignId: string;
    teamId: string | null;
    commentId: string;
    eventType: "comment.created" | "comment.edited" | "comment.deleted";
    occurredAt: string;
    actorKind: "campaign-grant" | "temporary-member" | "collection-collector";
    actorRef: string | null;
    payloadVersion: number;
    commentVersion: number;
    dedupeKey: string;
    operationId: string | null;
    requireVersion: number;
    requireDeleted: boolean;
  },
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO domain_events (
         id, campaign_id, team_id, field_session_id, entity_type, entity_id,
         event_type, occurred_at, actor_kind, actor_ref, payload_version,
         payload_json, dedupe_key, created_at
       )
       SELECT ?, ?, ?, NULL, 'comment', ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM comments
         WHERE id = ? AND campaign_id = ? AND version = ?
           AND ((? = 1 AND deleted_at IS NOT NULL) OR (? = 0 AND deleted_at IS NULL))
           AND (? IS NULL OR last_operation_id = ?)
       )`,
    )
    .bind(
      input.eventId,
      input.campaignId,
      input.teamId,
      input.commentId,
      input.eventType,
      input.occurredAt,
      input.actorKind,
      input.actorRef,
      input.payloadVersion,
      eventPayload(input.commentVersion),
      input.dedupeKey,
      new Date().toISOString(),
      input.commentId,
      input.campaignId,
      input.requireVersion,
      input.requireDeleted ? 1 : 0,
      input.requireDeleted ? 1 : 0,
      input.operationId,
      input.operationId,
    );
}

async function listComments(
  request: Request,
  db: D1DatabaseLike,
  route: CommentRoute,
  access: AccessContext,
) {
  const url = new URL(request.url);
  const targetType = normalizeCommentTargetType(url.searchParams.get("targetType"));
  const targetId = url.searchParams.get("targetId");
  if (!targetType || !targetId || !validSelector(targetId)) {
    return errorResponse(400, "invalid_comment_target", "Kommentar-Kontext ist ungültig.");
  }

  const target = await resolveTarget(db, route.campaignId, targetType, targetId);
  if (!target) {
    return errorResponse(404, "comment_target_not_found", "Kommentar-Kontext wurde nicht gefunden.");
  }
  if (!(await canReadCommentTarget(db, route.campaignId, access, targetType, target))) {
    return errorResponse(403, "comment_scope_forbidden", "Dieser Kommentar-Kontext liegt außerhalb deines Scopes.");
  }

  const limit = parsePageSize(url.searchParams.get("limit"));
  if (limit === null) return errorResponse(400, "invalid_limit", "Kommentar-Seitengröße ist ungültig.");
  const cursorValue = url.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) return errorResponse(400, "invalid_cursor", "Kommentar-Cursor ist ungültig.");

  const result = cursor
    ? await db
        .prepare(
          `SELECT id, campaign_id, target_type, target_id, team_id,
                  author_kind, author_ref, body, created_at, updated_at,
                  deleted_at, version, last_operation_id
           FROM comments
           WHERE campaign_id = ? AND target_type = ? AND target_id = ?
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(route.campaignId, targetType, targetId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
        .all<StoredComment>()
    : await db
        .prepare(
          `SELECT id, campaign_id, target_type, target_id, team_id,
                  author_kind, author_ref, body, created_at, updated_at,
                  deleted_at, version, last_operation_id
           FROM comments
           WHERE campaign_id = ? AND target_type = ? AND target_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(route.campaignId, targetType, targetId, limit + 1)
        .all<StoredComment>();

  const hasNextPage = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const comments = rows.map((comment) => publicComment(comment, access, target));
  const last = rows.at(-1);
  return json({
    comments,
    nextCursor: hasNextPage && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    canCreate: canCreateComment(access, targetType, target),
  });
}

async function createComment(
  request: Request,
  db: D1DatabaseLike,
  route: CommentRoute,
  access: AccessContext,
) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!hasOnlyKeys(parsed.value, ["commentId", "targetType", "targetId", "body"])) {
    return errorResponse(400, "invalid_comment", "Kommentar-Anfrage ist ungültig.");
  }
  const bodyValue = parsed.value.body;
  const body = normalizeCommentBody(bodyValue);
  if (!body) {
    return errorResponse(
      422,
      "invalid_comment_body",
      `Kommentar muss 1 bis ${COMMENT_BODY_MAX_LENGTH} Zeichen enthalten.`,
    );
  }
  const target = parseTarget(parsed.value);
  if (!target) return errorResponse(400, "invalid_comment_target", "Kommentar-Kontext ist ungültig.");

  const resolvedTarget = await resolveTarget(db, route.campaignId, target.targetType, target.targetId);
  if (!resolvedTarget) {
    return errorResponse(404, "comment_target_not_found", "Kommentar-Kontext wurde nicht gefunden.");
  }
  if (!(await canReadCommentTarget(db, route.campaignId, access, target.targetType, resolvedTarget))) {
    return errorResponse(403, "comment_scope_forbidden", "Dieser Kommentar-Kontext liegt außerhalb deines Scopes.");
  }
  if (!canCreateComment(access, target.targetType, resolvedTarget)) {
    const code = access.role === "viewer" ? "viewer_read_only" : "comment_write_forbidden";
    return errorResponse(403, code, "Du darfst in diesem Kommentar-Kontext nicht schreiben.");
  }

  const commentId = parsed.value.commentId === undefined
    ? `comment_${crypto.randomUUID()}`
    : parsed.value.commentId;
  if (!validSelector(commentId)) {
    return errorResponse(400, "invalid_comment_id", "Kommentar-ID ist ungültig.");
  }

  const actor = authorFor(access);
  const createdAt = new Date().toISOString();
  const [insertResult] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO comments (
           id, campaign_id, target_type, target_id, team_id,
           author_kind, author_ref, body, created_at, updated_at,
           deleted_at, version, last_operation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL)`,
      )
      .bind(
        commentId,
        route.campaignId,
        target.targetType,
        target.targetId,
        resolvedTarget.teamId,
        actor.kind,
        actor.ref,
        body,
        createdAt,
        createdAt,
      ),
    commentEventStatement(db, {
      eventId: `domain_event_comment_created_${commentId}`,
      campaignId: route.campaignId,
      teamId: resolvedTarget.teamId,
      commentId,
      eventType: "comment.created",
      occurredAt: createdAt,
      actorKind: actor.kind,
      actorRef: actor.ref,
      payloadVersion: 1,
      commentVersion: 1,
      dedupeKey: `comment:${commentId}:created`,
      operationId: null,
      requireVersion: 1,
      requireDeleted: false,
    }),
  ]);

  const existing = await getComment(db, route.campaignId, commentId);
  if (!existing) {
    return errorResponse(409, "comment_id_unavailable", "Kommentar konnte wegen einer ID-Kollision nicht gespeichert werden.");
  }
  const sameRequest =
    existing.target_type === target.targetType &&
    existing.target_id === target.targetId &&
    existing.body === body &&
    existing.author_kind === actor.kind &&
    existing.author_ref === actor.ref &&
    !existing.deleted_at;
  if (!sameRequest) {
    return errorResponse(409, "comment_id_reused", "Kommentar-ID wurde bereits für einen anderen Inhalt verwendet.");
  }

  return json(
    {
      comment: publicComment(existing, access, resolvedTarget),
      alreadyCreated: (insertResult?.meta?.changes ?? 0) !== 1,
    },
    { status: (insertResult?.meta?.changes ?? 0) === 1 ? 201 : 200 },
  );
}

async function editComment(
  request: Request,
  db: D1DatabaseLike,
  route: CommentRoute,
  access: AccessContext,
) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!hasOnlyKeys(parsed.value, ["body", "expectedUpdatedAt", "requestId"])) {
    return errorResponse(400, "invalid_comment", "Kommentar-Anfrage ist ungültig.");
  }
  const body = normalizeCommentBody(parsed.value.body);
  if (!body) {
    return errorResponse(
      422,
      "invalid_comment_body",
      `Kommentar muss 1 bis ${COMMENT_BODY_MAX_LENGTH} Zeichen enthalten.`,
    );
  }
  const expectedUpdatedAt = parsed.value.expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return errorResponse(400, "invalid_comment_version", "Kommentar-Version ist ungültig.");
  }
  const requestId = parsed.value.requestId === undefined
    ? `edit:${route.commentId}:${expectedUpdatedAt}`
    : parsed.value.requestId;
  if (!validSelector(requestId)) return errorResponse(400, "invalid_request_id", "Kommentar-Request-ID ist ungültig.");

  const current = await getComment(db, route.campaignId, route.commentId as string);
  if (!current) return errorResponse(404, "comment_not_found", "Kommentar wurde nicht gefunden.");
  const target = await resolveTarget(db, route.campaignId, current.target_type, current.target_id);
  if (!target) return errorResponse(404, "comment_target_not_found", "Kommentar-Kontext wurde nicht gefunden.");
  if (!(await canReadCommentTarget(db, route.campaignId, access, current.target_type, target))) {
    return errorResponse(403, "comment_scope_forbidden", "Dieser Kommentar-Kontext liegt außerhalb deines Scopes.");
  }
  if (!canModerateComment(access, current.target_type, target)) {
    return errorResponse(403, "comment_edit_forbidden", "Du darfst diesen Kommentar nicht bearbeiten.");
  }
  if (current.deleted_at) return errorResponse(409, "comment_deleted", "Gelöschte Kommentare können nicht bearbeitet werden.");
  if (current.last_operation_id === requestId) {
    return json({ comment: publicComment(current, access, target), alreadyEdited: true });
  }
  if (current.updated_at !== expectedUpdatedAt) {
    return errorResponse(409, "comment_conflict", "Der Kommentar wurde bereits geändert.");
  }

  const actor = authorFor(access);
  const updatedAt = new Date().toISOString();
  const version = current.version + 1;
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE comments
         SET body = ?, updated_at = ?, version = ?, last_operation_id = ?
         WHERE id = ? AND campaign_id = ? AND updated_at = ? AND deleted_at IS NULL`,
      )
      .bind(body, updatedAt, version, requestId, route.commentId, route.campaignId, expectedUpdatedAt),
    commentEventStatement(db, {
      eventId: `domain_event_comment_edited_${route.commentId}_${requestId}`,
      campaignId: route.campaignId,
      teamId: target.teamId,
      commentId: route.commentId as string,
      eventType: "comment.edited",
      occurredAt: updatedAt,
      actorKind: actor.kind,
      actorRef: actor.ref,
      payloadVersion: 1,
      commentVersion: version,
      dedupeKey: `comment:${route.commentId}:edited:${requestId}`,
      operationId: requestId,
      requireVersion: version,
      requireDeleted: false,
    }),
  ]);

  const updated = await getComment(db, route.campaignId, route.commentId as string);
  if (!updated) return errorResponse(404, "comment_not_found", "Kommentar wurde nicht gefunden.");
  if (updated.last_operation_id === requestId) {
    return json({ comment: publicComment(updated, access, target), alreadyEdited: (updateResult?.meta?.changes ?? 0) !== 1 });
  }
  return errorResponse(409, "comment_conflict", "Der Kommentar wurde bereits geändert.");
}

async function deleteComment(
  request: Request,
  db: D1DatabaseLike,
  route: CommentRoute,
  access: AccessContext,
) {
  const parsed = await readOptionalJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!hasOnlyKeys(parsed.value, ["requestId"])) {
    return errorResponse(400, "invalid_comment", "Kommentar-Anfrage ist ungültig.");
  }
  const requestId = parsed.value.requestId === undefined
    ? `delete:${route.commentId}`
    : parsed.value.requestId;
  if (!validSelector(requestId)) return errorResponse(400, "invalid_request_id", "Kommentar-Request-ID ist ungültig.");

  const current = await getComment(db, route.campaignId, route.commentId as string);
  if (!current) return errorResponse(404, "comment_not_found", "Kommentar wurde nicht gefunden.");
  const target = await resolveTarget(db, route.campaignId, current.target_type, current.target_id);
  if (!target) return errorResponse(404, "comment_target_not_found", "Kommentar-Kontext wurde nicht gefunden.");
  if (!(await canReadCommentTarget(db, route.campaignId, access, current.target_type, target))) {
    return errorResponse(403, "comment_scope_forbidden", "Dieser Kommentar-Kontext liegt außerhalb deines Scopes.");
  }
  if (!canModerateComment(access, current.target_type, target)) {
    return errorResponse(403, "comment_delete_forbidden", "Du darfst diesen Kommentar nicht löschen.");
  }
  if (current.deleted_at) {
    return json({ comment: publicComment(current, access, target), alreadyDeleted: true });
  }

  const actor = authorFor(access);
  const deletedAt = new Date().toISOString();
  const version = current.version + 1;
  const [deleteResult] = await db.batch([
    db
      .prepare(
        `UPDATE comments
         SET body = NULL, deleted_at = ?, updated_at = ?, version = ?, last_operation_id = ?
         WHERE id = ? AND campaign_id = ? AND deleted_at IS NULL`,
      )
      .bind(deletedAt, deletedAt, version, requestId, route.commentId, route.campaignId),
    commentEventStatement(db, {
      eventId: `domain_event_comment_deleted_${route.commentId}`,
      campaignId: route.campaignId,
      teamId: target.teamId,
      commentId: route.commentId as string,
      eventType: "comment.deleted",
      occurredAt: deletedAt,
      actorKind: actor.kind,
      actorRef: actor.ref,
      payloadVersion: 1,
      commentVersion: version,
      dedupeKey: `comment:${route.commentId}:deleted`,
      operationId: requestId,
      requireVersion: version,
      requireDeleted: true,
    }),
  ]);

  const deleted = await getComment(db, route.campaignId, route.commentId as string);
  if (!deleted) return errorResponse(404, "comment_not_found", "Kommentar wurde nicht gefunden.");
  if (deleted.deleted_at) {
    return json({
      comment: publicComment(deleted, access, target),
      alreadyDeleted: (deleteResult?.meta?.changes ?? 0) !== 1,
    });
  }
  return errorResponse(409, "comment_conflict", "Kommentar konnte nicht gelöscht werden.");
}

async function resolveCommentsAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
) {
  const access = await resolveAccess(db, request, campaignId);
  if (access) return access;
  return resolveCollectionAccess(db, request, campaignId);
}

export async function handleCommentsApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseCommentsRoute(new URL(request.url).pathname);
  if (!route) return null;

  if (request.method !== "GET" && !sameOrigin(request)) {
    return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
  }

  try {
    const access = await resolveCommentsAccess(db, request, route.campaignId);
    if (!access) return errorResponse(401, "access_required", "Gültiger Campaign- oder Collection-Zugriff ist erforderlich.");

    if (!(await hasCommentsSchema(db))) {
      return errorResponse(
        503,
        "comments_schema_unavailable",
        "Kommentar-Datenbankmigration ist noch nicht angewendet.",
      );
    }

    if (request.method === "GET" && route.commentId === null) {
      return await listComments(request, db, route, access);
    }
    if (request.method === "POST" && route.commentId === null) {
      return await createComment(request, db, route, access);
    }
    if (request.method === "PATCH" && route.commentId !== null) {
      return await editComment(request, db, route, access);
    }
    if (request.method === "DELETE" && route.commentId !== null) {
      return await deleteComment(request, db, route, access);
    }
    return errorResponse(405, "method_not_allowed", "Methode für Comments ist nicht erlaubt.");
  } catch (error) {
    if (error instanceof Error && error.message === PICKUP_COMMENTS_SCHEMA_ERROR) {
      return errorResponse(
        503,
        PICKUP_COMMENTS_SCHEMA_ERROR,
        "Pickup-Kommentare benötigen die vorbereitete Migration 0013.",
      );
    }
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "comments_schema_unavailable",
        "Kommentar-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "comments_failed", "Kommentare konnten nicht verarbeitet werden.");
  }
}
