import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashSecret } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  handleActivityApi,
  parseActivityRoute,
  SUPPORTED_ACTIVITY_EVENT_TYPES,
} from "../worker/activity.ts";
import productionWorker from "../worker/indexM55.ts";

const migrationFiles = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0004_m6_task_source_provenance.sql",
  "0005_m6_house_tasks.sql",
  "0006_fc1_field_groups.sql",
  "0007_field_sessions_events.sql",
  "0008_comments.sql",
];

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const row = this.db.prepare(this.query).get(...this.values);
    return (row ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } } satisfies D1RunResult;
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly raw = new DatabaseSync(":memory:");

  prepare(query: string) {
    return new SqliteStatement(this.raw, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.raw.exec("BEGIN");
    try {
      const results = statements.map((statement) => (statement as SqliteStatement).run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

async function database(withActivitySchema = true) {
  const db = new SqliteD1();
  const files = withActivitySchema ? migrationFiles : migrationFiles.slice(0, 6);
  for (const file of files) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const timestamp = "2026-08-28T10:00:00.000Z";
  db.raw.exec(`
    INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
    VALUES
      ('campaign_activity', 'Aktivität', 'active', 0, 'internal-write-token-a', '${timestamp}', '${timestamp}'),
      ('campaign_other', 'Andere Campaign', 'active', 0, 'internal-write-token-b', '${timestamp}', '${timestamp}');
    INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES
      ('team_a', 'campaign_activity', 'Team A', '#ea580c', '${timestamp}', '${timestamp}'),
      ('team_b', 'campaign_activity', 'Team B', '#2563eb', '${timestamp}', '${timestamp}'),
      ('team_other', 'campaign_other', 'Other Team', '#16a34a', '${timestamp}', '${timestamp}');
    INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES
      ('area_a', 'campaign_activity', 'team_a', 'Gebiet A', '{"type":"Polygon","coordinates":[[[10,50],[10.1,50],[10.1,50.1],[10,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_b', 'campaign_activity', 'team_b', 'Gebiet B', '{"type":"Polygon","coordinates":[[[11,50],[11.1,50],[11.1,50.1],[11,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_other', 'campaign_other', 'team_other', 'Fremdes Gebiet', '{"type":"Polygon","coordinates":[[[12,50],[12.1,50],[12.1,50.1],[12,50]]]}', '${timestamp}', '${timestamp}');
    INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('street_a', 'campaign_activity', 'area_a', 'street', 'Hauptstraße', '{"type":"LineString","coordinates":[[10,50],[10.1,50.1]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}'),
      ('street_b', 'campaign_activity', 'area_b', 'street', 'Nebenstraße', '{"type":"LineString","coordinates":[[11,50],[11.1,50.1]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}');
    INSERT INTO house_tasks (id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('house_a', 'campaign_activity', 'area_a', 'street_a', 'Haus A', '{"type":"Polygon","coordinates":[[[10,50],[10.01,50],[10.01,50.01],[10,50]]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}');
  `);
  return db;
}

let sequence = 0;

async function persistentAccess(
  db: SqliteD1,
  role: "admin" | "team-editor" | "viewer",
  teamId: string | null = null,
) {
  sequence += 1;
  const secret = `${role}-activity-session-${sequence}`;
  const grantId = `grant_activity_${role}_${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const tokenHash = createHash("sha256").update(`${secret}-token`).digest("hex");
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
       VALUES (?, 'campaign_activity', ?, ?, ?, ?, ?, NULL)`,
    )
    .run(grantId, role, teamId, tokenHash, `${role} activity test`, timestamp);
  db.raw
    .prepare(
      `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
       VALUES (?, ?, 'campaign_activity', ?, ?, '2099-01-01T00:00:00.000Z')`,
    )
    .run(`session_activity_${sequence}`, grantId, sessionHash, timestamp);
  return `vf_session=${secret}`;
}

async function temporaryAccess(db: SqliteD1, groupId = "group_activity_temp", teamId = "team_a") {
  sequence += 1;
  const secret = `temporary-activity-session-${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const membershipId = `membership_activity_${sequence}`;
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO field_groups
       (id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
        created_by_grant_id, create_request_id, create_payload_hash, created_at,
        hard_expires_at, closed_at, updated_at)
       VALUES (?, 'campaign_activity', ?, 'Temporäre Gruppe', 'distribution', 1, 'active', 1,
        NULL, ?, ?, ?, '2099-01-01T00:00:00.000Z', NULL, ?)`,
    )
    .run(groupId, teamId, `activity_create_${sequence}`, "activity-hash", timestamp, timestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships
       (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
        joined_at, expires_at, left_at, removed_at)
       VALUES (?, 'campaign_activity', ?, ?, NULL, ?, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(membershipId, groupId, teamId, sessionHash, timestamp);
  return {
    cookie: `vf_field_group_session=${secret}`,
    groupId,
    membershipId,
    sessionId: `field_session_group_${groupId}`,
  };
}

function request(
  path: string,
  options: { method?: string; cookie?: string; origin?: string } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`https://flyer.test${path}`, {
    method: options.method ?? "GET",
    headers,
  });
}

type ActivityResponse = {
  activities: Array<Record<string, unknown>>;
  nextCursor: string | null;
  error?: { code?: string };
};

async function payload(response: Response) {
  return (await response.json()) as ActivityResponse;
}

function insertEvent(
  db: SqliteD1,
  input: {
    id: string;
    campaignId?: string;
    teamId?: string | null;
    fieldSessionId?: string | null;
    entityType: string;
    entityId: string;
    eventType: string;
    occurredAt: string;
    actorKind?: string;
    actorRef?: string | null;
    payload?: string;
    dedupeKey?: string;
  },
) {
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO domain_events (
        id, campaign_id, team_id, field_session_id, entity_type, entity_id,
        event_type, occurred_at, actor_kind, actor_ref, payload_version,
        payload_json, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.campaignId ?? "campaign_activity",
      input.teamId ?? null,
      input.fieldSessionId ?? null,
      input.entityType,
      input.entityId,
      input.eventType,
      input.occurredAt,
      input.actorKind ?? "unknown",
      input.actorRef ?? null,
      input.payload ?? "{}",
      input.dedupeKey ?? `activity:${input.id}`,
      input.occurredAt,
    );
}

function insertSession(
  db: SqliteD1,
  input: { id: string; teamId: string; startedAt: string; endedAt: string; endReason: "manual-close" | "group-expired" },
) {
  const duration = input.endReason === "manual-close" ? 3_600 : 1_800;
  const participantCount = input.endReason === "manual-close" ? 2 : null;
  const personSeconds = participantCount === null ? null : duration * participantCount;
  db.raw
    .prepare(
      `INSERT INTO field_sessions (
        id, campaign_id, team_id, field_group_id, mode, started_at, ended_at,
        end_reason, duration_seconds, participant_count, person_seconds, note,
        status, created_at, updated_at
      ) VALUES (?, 'campaign_activity', ?, NULL, 'distribution', ?, ?, ?, ?, ?, ?, NULL, 'closed', ?, ?)`,
    )
    .run(
      input.id,
      input.teamId,
      input.startedAt,
      input.endedAt,
      input.endReason,
      duration,
      participantCount,
      personSeconds,
      input.startedAt,
      input.endedAt,
    );
}

function insertComment(db: SqliteD1, id: string, targetType: string, targetId: string, teamId: string | null) {
  db.raw
    .prepare(
      `INSERT INTO comments (
        id, campaign_id, target_type, target_id, team_id, author_kind, author_ref,
        body, created_at, updated_at, deleted_at, version, last_operation_id
      ) VALUES (?, 'campaign_activity', ?, ?, ?, 'campaign-grant', NULL,
        ?,
        '2026-08-28T10:00:00.000Z', '2026-08-28T10:00:00.000Z', NULL, 1, NULL)`,
    )
    .run(id, targetType, targetId, teamId, "<script>alert(1)</script>'; DROP TABLE comments; --");
}

function seedAllEventTypes(db: SqliteD1) {
  insertSession(db, {
    id: "session_closed_a",
    teamId: "team_a",
    startedAt: "2026-08-28T09:00:00.000Z",
    endedAt: "2026-08-28T10:00:00.000Z",
    endReason: "manual-close",
  });
  insertSession(db, {
    id: "session_expired_b",
    teamId: "team_b",
    startedAt: "2026-08-28T09:30:00.000Z",
    endedAt: "2026-08-28T10:00:00.000Z",
    endReason: "group-expired",
  });
  insertComment(db, "comment_activity", "area", "area_a", "team_a");

  insertEvent(db, {
    id: "event_session_closed",
    teamId: "team_a",
    fieldSessionId: "session_closed_a",
    entityType: "field-session",
    entityId: "session_closed_a",
    eventType: "field_session.closed",
    occurredAt: "2026-08-28T10:01:00.000Z",
    actorKind: "unknown",
  });
  insertEvent(db, {
    id: "event_session_expired",
    teamId: "team_b",
    fieldSessionId: "session_expired_b",
    entityType: "field-session",
    entityId: "session_expired_b",
    eventType: "field_session.expired",
    occurredAt: "2026-08-28T10:02:00.000Z",
    actorKind: "system",
  });
  insertEvent(db, {
    id: "event_task_status",
    teamId: "team_a",
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:03:00.000Z",
    actorKind: "campaign-grant",
    actorRef: "private-actor-ref",
    payload: JSON.stringify({ previousStatus: "open", newStatus: "completed" }),
  });
  insertEvent(db, {
    id: "event_comment_created",
    teamId: "team_a",
    entityType: "comment",
    entityId: "comment_activity",
    eventType: "comment.created",
    occurredAt: "2026-08-28T10:04:00.000Z",
    actorKind: "campaign-grant",
    actorRef: "private-comment-actor",
    payload: JSON.stringify({ version: 1, body: "should never be copied" }),
  });
  insertEvent(db, {
    id: "event_comment_edited",
    teamId: "team_a",
    entityType: "comment",
    entityId: "comment_activity",
    eventType: "comment.edited",
    occurredAt: "2026-08-28T10:05:00.000Z",
    actorKind: "campaign-grant",
    payload: JSON.stringify({ version: 2, previousBody: "private old body" }),
  });
  insertEvent(db, {
    id: "event_comment_deleted",
    teamId: "team_a",
    entityType: "comment",
    entityId: "comment_activity",
    eventType: "comment.deleted",
    occurredAt: "2026-08-28T10:06:00.000Z",
    actorKind: "campaign-grant",
    payload: JSON.stringify({ version: 3, body: "private deleted body" }),
  });
}

test("Activity route, event allowlist and schema failure are explicit", async () => {
  assert.deepEqual(
    parseActivityRoute("/api/campaigns/campaign_activity/activity"),
    { campaignId: "campaign_activity" },
  );
  assert.equal(parseActivityRoute("/api/campaigns/%2F/activity"), null);
  assert.deepEqual(SUPPORTED_ACTIVITY_EVENT_TYPES, [
    "field_session.closed",
    "field_session.expired",
    "task.status.changed",
    "comment.created",
    "comment.edited",
    "comment.deleted",
  ]);

  const db = await database();
  const unauthenticated = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity"),
    db,
  );
  assert.equal(unauthenticated?.status, 401);

  const schemaMissingDb = await database(false);
  const admin = await persistentAccess(schemaMissingDb, "admin");
  const unavailable = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity", { cookie: admin }),
    schemaMissingDb,
  );
  assert.equal(unavailable?.status, 503);
  assert.equal((await payload(unavailable!)).error?.code, "activity_schema_unavailable");
});

test("admin projection supports all real events without raw payload or identity leakage", async () => {
  const db = await database();
  seedAllEventTypes(db);
  insertEvent(db, {
    id: "event_unsupported",
    teamId: "team_a",
    entityType: "credential",
    entityId: "credential_a",
    eventType: "security.credential.used",
    occurredAt: "2026-08-28T10:07:00.000Z",
    actorKind: "organization-account",
    actorRef: "token-and-session-hash",
    payload: JSON.stringify({ cookie: "secret-cookie", qrToken: "secret-qr" }),
  });
  insertEvent(db, {
    id: "event_unknown_entity",
    teamId: "team_a",
    entityType: "removed-task",
    entityId: "missing-task",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:08:00.000Z",
    actorKind: "unknown",
    payload: "not-json",
  });

  const admin = await persistentAccess(db, "admin");
  const response = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity?limit=50", { cookie: admin }),
    db,
  );
  assert.equal(response?.status, 200);
  const result = await payload(response!);
  assert.equal(result.activities.length, 7);
  assert.deepEqual(
    new Set(result.activities.map((activity) => activity.eventType)),
    new Set([...SUPPORTED_ACTIVITY_EVENT_TYPES, "task.status.changed"]),
  );

  const task = result.activities.find((activity) => activity.id === "event_task_status");
  assert.deepEqual(task?.details, {
    kind: "task-status-changed",
    taskType: "street",
    targetLabel: "Hauptstraße",
    contextLabel: "Gebiet A",
    previousStatus: "open",
    newStatus: "completed",
  });
  const closed = result.activities.find((activity) => activity.id === "event_session_closed");
  assert.deepEqual(closed?.details, {
    kind: "field-session-closed",
    durationSeconds: 3600,
    participantCount: 2,
    personSeconds: 7200,
  });
  const expired = result.activities.find((activity) => activity.id === "event_session_expired");
  assert.deepEqual(expired?.details, {
    kind: "field-session-expired",
    durationSeconds: 1800,
    participantCount: null,
    personSeconds: null,
  });
  const comment = result.activities.find((activity) => activity.id === "event_comment_created");
  assert.equal((comment?.details as { targetLabel?: string }).targetLabel, "Gebiet A");
  assert.equal(JSON.stringify(result).includes("payload_json"), false);
  assert.equal(JSON.stringify(result).includes("private old body"), false);
  assert.equal(JSON.stringify(result).includes("secret-cookie"), false);
  assert.equal(JSON.stringify(result).includes("token-and-session-hash"), false);
  assert.equal(JSON.stringify(result).includes("<script>"), false);
  assert.equal(JSON.stringify(result).includes("not-json"), false);
  assert.equal(result.activities.some((activity) => activity.id === "event_unsupported"), false);
  const unknown = result.activities.find((activity) => activity.id === "event_unknown_entity");
  assert.equal(unknown?.entityType, "unknown");
  assert.equal((unknown?.details as { targetLabel?: string }).targetLabel, "Aufgabe");
});

test("viewer is Campaign-scoped while Team Editor is forced to the canonical own team", async () => {
  const db = await database();
  seedAllEventTypes(db);
  insertEvent(db, {
    id: "event_team_b_task",
    teamId: "team_b",
    entityType: "street-task",
    entityId: "street_b",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:07:00.000Z",
    actorKind: "campaign-grant",
    payload: JSON.stringify({ previousStatus: "later", newStatus: "open" }),
  });
  insertEvent(db, {
    id: "event_campaign_comment",
    entityType: "comment",
    entityId: "comment_campaign",
    eventType: "comment.created",
    occurredAt: "2026-08-28T10:08:00.000Z",
    actorKind: "campaign-grant",
  });

  const viewer = await persistentAccess(db, "viewer");
  const viewerResponse = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity", { cookie: viewer }),
    db,
  );
  assert.equal(viewerResponse?.status, 200);
  const viewerResult = await payload(viewerResponse!);
  assert.equal(viewerResult.activities.some((activity) => activity.id === "event_team_b_task"), true);
  assert.equal(viewerResult.activities.some((activity) => activity.id === "event_campaign_comment"), true);

  const filtered = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity?team=team_b", { cookie: viewer }),
    db,
  );
  assert.equal(filtered?.status, 200);
  const filteredResult = await payload(filtered!);
  assert.equal(filteredResult.activities.every((activity) => activity.teamId === "team_b"), true);

  const editor = await persistentAccess(db, "team-editor", "team_a");
  const editorResponse = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity", { cookie: editor }),
    db,
  );
  assert.equal(editorResponse?.status, 200);
  const editorResult = await payload(editorResponse!);
  assert.equal(editorResult.activities.some((activity) => activity.id === "event_team_b_task"), false);
  assert.equal(editorResult.activities.some((activity) => activity.id === "event_campaign_comment"), false);
  assert.equal(editorResult.activities.every((activity) => activity.teamId === "team_a"), true);

  const foreignFilter = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity?team=team_b", { cookie: editor }),
    db,
  );
  assert.equal(foreignFilter?.status, 403);
});

test("temporary member sees only the exact Field Group session and own comment events", async () => {
  const db = await database();
  const temporary = await temporaryAccess(db);
  insertSession(db, {
    id: "session_other_a",
    teamId: "team_a",
    startedAt: "2026-08-28T09:00:00.000Z",
    endedAt: "2026-08-28T10:00:00.000Z",
    endReason: "manual-close",
  });
  insertEvent(db, {
    id: "event_temp_own_session",
    teamId: "team_a",
    fieldSessionId: temporary.sessionId,
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:01:00.000Z",
    actorKind: "temporary-member",
    actorRef: temporary.membershipId,
    payload: JSON.stringify({ previousStatus: "open", newStatus: "completed" }),
  });
  insertEvent(db, {
    id: "event_temp_other_session",
    teamId: "team_a",
    fieldSessionId: "session_other_a",
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:02:00.000Z",
    actorKind: "temporary-member",
    actorRef: "other-membership",
    payload: JSON.stringify({ previousStatus: "open", newStatus: "later" }),
  });
  insertComment(db, "comment_temp_own", "street-task", "street_a", "team_a");
  insertEvent(db, {
    id: "event_temp_own_comment",
    teamId: "team_a",
    entityType: "comment",
    entityId: "comment_temp_own",
    eventType: "comment.created",
    occurredAt: "2026-08-28T10:03:00.000Z",
    actorKind: "temporary-member",
    actorRef: temporary.membershipId,
  });
  insertComment(db, "comment_temp_other", "area", "area_a", "team_a");
  insertEvent(db, {
    id: "event_temp_other_comment",
    teamId: "team_a",
    entityType: "comment",
    entityId: "comment_temp_other",
    eventType: "comment.created",
    occurredAt: "2026-08-28T10:04:00.000Z",
    actorKind: "campaign-grant",
    actorRef: "other-grant",
  });
  insertEvent(db, {
    id: "event_temp_null_session_task",
    teamId: "team_a",
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:05:00.000Z",
    actorKind: "temporary-member",
    actorRef: temporary.membershipId,
  });
  insertEvent(db, {
    id: "event_temp_foreign_team",
    teamId: "team_b",
    entityType: "street-task",
    entityId: "street_b",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:06:00.000Z",
    actorKind: "temporary-member",
    actorRef: temporary.membershipId,
  });

  const response = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity", { cookie: temporary.cookie }),
    db,
  );
  assert.equal(response?.status, 200);
  const result = await payload(response!);
  assert.deepEqual(
    new Set(result.activities.map((activity) => activity.id)),
    new Set(["event_temp_own_session", "event_temp_own_comment"]),
  );
  assert.equal(result.activities.every((activity) => activity.teamId === "team_a"), true);
});

test("Activity uses default/max limits and a stable time/id cursor", async () => {
  const db = await database();
  for (let index = 0; index < 31; index += 1) {
    insertEvent(db, {
      id: `event_page_${String(index).padStart(2, "0")}`,
      teamId: "team_a",
      entityType: "street-task",
      entityId: "street_a",
      eventType: "task.status.changed",
      occurredAt: "2026-08-28T11:00:00.000Z",
      payload: JSON.stringify({ previousStatus: "open", newStatus: "completed" }),
    });
  }
  const admin = await persistentAccess(db, "admin");
  const first = await handleActivityApi(
    request("/api/campaigns/campaign_activity/activity", { cookie: admin }),
    db,
  );
  assert.equal(first?.status, 200);
  const firstPage = await payload(first!);
  assert.equal(firstPage.activities.length, 30);
  assert.ok(firstPage.nextCursor);
  assert.equal(firstPage.activities[0].id, "event_page_30");
  assert.equal(firstPage.activities[29].id, "event_page_01");

  const second = await handleActivityApi(
    request(
      `/api/campaigns/campaign_activity/activity?limit=30&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { cookie: admin },
    ),
    db,
  );
  assert.equal(second?.status, 200);
  const secondPage = await payload(second!);
  assert.deepEqual(secondPage.activities.map((activity) => activity.id), ["event_page_00"]);
  assert.equal(firstPage.activities.some((activity) => activity.id === secondPage.activities[0].id), false);
  assert.equal(
    (
      await handleActivityApi(
        request("/api/campaigns/campaign_activity/activity?limit=51", { cookie: admin }),
        db,
      )
    )?.status,
    400,
  );
  assert.equal(
    (
      await handleActivityApi(
        request("/api/campaigns/campaign_activity/activity?cursor=broken", { cookie: admin }),
        db,
      )
    )?.status,
    400,
  );
});

test("duplicate event retries project once and cross-campaign/cross-origin requests fail closed", async () => {
  const db = await database();
  insertEvent(db, {
    id: "event_dedupe_once",
    teamId: "team_a",
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:10:00.000Z",
    dedupeKey: "same-activity-retry",
  });
  insertEvent(db, {
    id: "event_dedupe_retry",
    teamId: "team_a",
    entityType: "street-task",
    entityId: "street_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-28T10:10:00.000Z",
    dedupeKey: "same-activity-retry",
  });
  const count = db.raw
    .prepare("SELECT COUNT(*) AS count FROM domain_events WHERE dedupe_key = ?")
    .get("same-activity-retry") as { count: number };
  assert.equal(count.count, 1);

  const admin = await persistentAccess(db, "admin");
  const crossCampaign = await handleActivityApi(
    request("/api/campaigns/campaign_other/activity", { cookie: admin }),
    db,
  );
  assert.equal(crossCampaign?.status, 401);
  const crossOrigin = await productionWorker.fetch(
    request("/api/campaigns/campaign_activity/activity", {
      method: "POST",
      cookie: admin,
      origin: "https://evil.example",
    }),
    { DB: db },
  );
  assert.equal(crossOrigin.status, 403);
});
