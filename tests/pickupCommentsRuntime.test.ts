import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hashSecret } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { handleCommentsApi } from "../worker/comments.ts";

const BASE_MIGRATIONS = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0006_fc1_field_groups.sql",
  "0007_field_sessions_events.sql",
  "0008_comments.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
  "0012_fc5_collection_pickup_visibility.sql",
];

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(private readonly db: DatabaseSync, readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    } satisfies D1RunResult;
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

function applyMigration(db: SqliteD1, file: string) {
  db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
}

async function database() {
  const db = new SqliteD1();
  for (const file of BASE_MIGRATIONS) applyMigration(db, file);

  const stamp = "2026-08-31T09:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaigns
       (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_pickup_comments', 'Pickup Comments', 'active', 0, 'write-token', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
     VALUES ('team_pickup_comments', 'campaign_pickup_comments', 'Team', '#2563eb', ?, ?)`,
  ).run(stamp, stamp);

  db.raw.prepare(
    `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_pickup_comments_admin', 'campaign_pickup_comments', 'admin', NULL,
             'unused-token-hash', 'Admin', ?, NULL)`,
  ).run(stamp);
  const adminSecret = "pickup-comments-admin-session";
  db.raw.prepare(
    `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
     VALUES ('session_pickup_comments_admin', 'grant_pickup_comments_admin',
             'campaign_pickup_comments', ?, ?, '2099-01-01T00:00:00.000Z')`,
  ).run(await hashSecret(adminSecret), stamp);

  db.raw.prepare(
    `INSERT INTO collection_access_links
       (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('access_pickup_comments', 'campaign_pickup_comments', 'access-hash', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_pickup_comments', 'campaign_pickup_comments', 'access_pickup_comments',
             'Nutzer 1', ?, NULL)`,
  ).run(stamp);
  const collectorSecret = "pickup-comments-collector-session";
  db.raw.prepare(
    `INSERT INTO collection_collector_sessions
       (id, collector_id, campaign_id, session_hash, created_at, expires_at, revoked_at)
     VALUES ('collection_session_pickup_comments', 'collector_pickup_comments',
             'campaign_pickup_comments', ?, ?, '2099-01-01T00:00:00.000Z', NULL)`,
  ).run(await hashSecret(collectorSecret), stamp);

  db.raw.prepare(
    `INSERT INTO collection_pickups (
       id, campaign_id, area_id, title, address, description, longitude, latitude,
       status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
       source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
       created_at, updated_at
     ) VALUES (
       'collection_pickup_comment', 'campaign_pickup_comments', NULL, 'Abholung',
       'Hauptstraße 1', 'Seiteneingang', 10.05, 50.05, 'open', NULL, '[]', '[]', NULL,
       'campaign-grant', 'grant_pickup_comments_admin', 'campaign-grant',
       'grant_pickup_comments_admin', ?, ?)`,
  ).run(stamp, stamp);

  return { db, adminSecret, collectorSecret };
}

function commentsUrl(targetId = "collection_pickup_comment") {
  return `https://flyer.test/api/campaigns/campaign_pickup_comments/comments?targetType=pickup-task&targetId=${targetId}`;
}

function collectorRequest(secret: string, targetId = "collection_pickup_comment") {
  return new Request(commentsUrl(targetId), {
    headers: { cookie: `vf_collection_session=${encodeURIComponent(secret)}` },
  });
}

function adminRequest(secret: string, targetId = "collection_pickup_comment") {
  return new Request(commentsUrl(targetId), {
    headers: { cookie: `vf_session=${encodeURIComponent(secret)}` },
  });
}

function createCollectorCommentRequest(secret: string, body = "Bitte vorher anrufen") {
  return new Request("https://flyer.test/api/campaigns/campaign_pickup_comments/comments", {
    method: "POST",
    headers: {
      cookie: `vf_collection_session=${encodeURIComponent(secret)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      commentId: "comment_pickup_runtime",
      targetType: "pickup-task",
      targetId: "collection_pickup_comment",
      body,
    }),
  });
}

test("Pickup comment read fails with a specific schema gate before migration 0013", async () => {
  const { db, collectorSecret } = await database();
  const response = await handleCommentsApi(collectorRequest(collectorSecret), db);
  assert.ok(response);
  assert.equal(response.status, 503);
  const payload = (await response.json()) as { error: { code: string } };
  assert.equal(payload.error.code, "pickup_comments_schema_unavailable");
});

test("migration 0013 preserves existing Comments and Events and keeps Field Group triggers usable", async () => {
  const { db } = await database();
  const stamp = "2026-08-31T09:10:00.000Z";
  db.raw.prepare(
    `INSERT INTO comments (
       id, campaign_id, target_type, target_id, team_id, author_kind, author_ref,
       body, created_at, updated_at, deleted_at, version, last_operation_id
     ) VALUES (
       'comment_before_0013', 'campaign_pickup_comments', 'campaign',
       'campaign_pickup_comments', NULL, 'campaign-grant', 'grant_pickup_comments_admin',
       'Bestandskommentar', ?, ?, NULL, 1, NULL)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO domain_events (
       id, campaign_id, team_id, field_session_id, entity_type, entity_id,
       event_type, occurred_at, actor_kind, actor_ref, payload_version,
       payload_json, dedupe_key, created_at
     ) VALUES (
       'event_before_0013', 'campaign_pickup_comments', NULL, NULL, 'comment',
       'comment_before_0013', 'comment.created', ?, 'campaign-grant',
       'grant_pickup_comments_admin', 1, '{"version":1}',
       'comment:before-0013', ?)`,
  ).run(stamp, stamp);

  applyMigration(db, "0013_fc5_pickup_comments.sql");

  const comment = db.raw.prepare(
    `SELECT target_type, team_id, author_kind, author_ref, body, version
       FROM comments WHERE id = 'comment_before_0013'`,
  ).get() as Record<string, unknown>;
  assert.equal(comment.target_type, "campaign");
  assert.equal(comment.team_id, null);
  assert.equal(comment.author_kind, "campaign-grant");
  assert.equal(comment.author_ref, "grant_pickup_comments_admin");
  assert.equal(comment.body, "Bestandskommentar");
  assert.equal(comment.version, 1);

  const event = db.raw.prepare(
    `SELECT event_type, actor_kind, actor_ref, payload_json
       FROM domain_events WHERE id = 'event_before_0013'`,
  ).get() as Record<string, unknown>;
  assert.equal(event.event_type, "comment.created");
  assert.equal(event.actor_kind, "campaign-grant");
  assert.equal(event.actor_ref, "grant_pickup_comments_admin");
  assert.equal(event.payload_json, '{"version":1}');

  db.raw.prepare(
    `INSERT INTO field_groups (
       id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
       created_by_grant_id, create_request_id, create_payload_hash, created_at,
       hard_expires_at, closed_at, updated_at
     ) VALUES (
       'field_group_after_0013', 'campaign_pickup_comments', 'team_pickup_comments',
       'Testgruppe', 'distribution', 1, 'active', 2, NULL,
       'request_after_0013', 'hash_after_0013', '2026-08-31T09:20:00.000Z',
       '2026-09-01T09:20:00.000Z', NULL, '2026-08-31T09:20:00.000Z')`,
  ).run();
  assert.equal(
    (db.raw.prepare(
      "SELECT COUNT(*) AS count FROM field_sessions WHERE field_group_id = 'field_group_after_0013'",
    ).get() as { count: number }).count,
    1,
  );

  db.raw.prepare(
    `UPDATE field_groups
        SET state = 'closed', closed_at = '2026-08-31T10:20:00.000Z',
            updated_at = '2026-08-31T10:20:00.000Z'
      WHERE id = 'field_group_after_0013'`,
  ).run();
  assert.equal(
    (db.raw.prepare(
      `SELECT COUNT(*) AS count FROM domain_events
        WHERE event_type = 'field_session.closed'
          AND entity_id = 'field_session_group_field_group_after_0013'`,
    ).get() as { count: number }).count,
    1,
  );
});

test("visible Collection Collector can create and read one durable Pickup comment with minimized event data", async () => {
  const { db, collectorSecret } = await database();
  applyMigration(db, "0013_fc5_pickup_comments.sql");

  const initial = await handleCommentsApi(collectorRequest(collectorSecret), db);
  assert.ok(initial);
  assert.equal(initial.status, 200);
  const initialPayload = (await initial.json()) as { comments: unknown[]; canCreate: boolean };
  assert.deepEqual(initialPayload.comments, []);
  assert.equal(initialPayload.canCreate, true);

  const created = await handleCommentsApi(createCollectorCommentRequest(collectorSecret), db);
  assert.ok(created);
  assert.equal(created.status, 201);
  const createdPayload = (await created.json()) as {
    comment: {
      targetType: string;
      targetId: string;
      body: string | null;
      authorLabel: string;
      canEdit: boolean;
      canDelete: boolean;
    };
  };
  assert.equal(createdPayload.comment.targetType, "pickup-task");
  assert.equal(createdPayload.comment.targetId, "collection_pickup_comment");
  assert.equal(createdPayload.comment.body, "Bitte vorher anrufen");
  assert.equal(createdPayload.comment.authorLabel, "Collection-Helfer");
  assert.equal(createdPayload.comment.canEdit, false);
  assert.equal(createdPayload.comment.canDelete, false);

  const row = db.raw.prepare(
    `SELECT target_type, target_id, team_id, author_kind, author_ref, body
       FROM comments WHERE id = 'comment_pickup_runtime'`,
  ).get() as Record<string, unknown>;
  assert.equal(row.target_type, "pickup-task");
  assert.equal(row.target_id, "collection_pickup_comment");
  assert.equal(row.team_id, null);
  assert.equal(row.author_kind, "collection-collector");
  assert.equal(row.author_ref, "collector_pickup_comments");
  assert.equal(row.body, "Bitte vorher anrufen");

  const event = db.raw.prepare(
    `SELECT actor_kind, actor_ref, payload_json
       FROM domain_events
      WHERE dedupe_key = 'comment:comment_pickup_runtime:created'`,
  ).get() as Record<string, unknown>;
  assert.equal(event.actor_kind, "collection-collector");
  assert.equal(event.actor_ref, "collector_pickup_comments");
  assert.equal(event.payload_json, '{"version":1}');
  assert.doesNotMatch(
    JSON.stringify(event),
    /Bitte vorher anrufen|Hauptstraße 1|Seiteneingang|pickup-comments-collector-session/u,
  );

  const listed = await handleCommentsApi(collectorRequest(collectorSecret), db);
  assert.ok(listed);
  assert.equal(listed.status, 200);
  const listedPayload = (await listed.json()) as { comments: Array<{ id: string }> };
  assert.deepEqual(listedPayload.comments.map((comment) => comment.id), ["comment_pickup_runtime"]);
});

test("Pickup view=false blocks comment reads and writes even when create was forged true", async () => {
  const { db, collectorSecret } = await database();
  applyMigration(db, "0013_fc5_pickup_comments.sql");
  db.raw.prepare(
    `UPDATE collection_collectors
        SET can_view_pickups = 0, can_create_pickups = 1
      WHERE id = 'collector_pickup_comments'`,
  ).run();

  const read = await handleCommentsApi(collectorRequest(collectorSecret), db);
  assert.ok(read);
  assert.equal(read.status, 403);
  const readText = await read.text();
  assert.doesNotMatch(readText, /Abholung|Hauptstraße|Seiteneingang/u);

  const write = await handleCommentsApi(createCollectorCommentRequest(collectorSecret), db);
  assert.ok(write);
  assert.equal(write.status, 403);
  assert.equal(
    (db.raw.prepare(
      "SELECT COUNT(*) AS count FROM comments WHERE target_type = 'pickup-task'",
    ).get() as { count: number }).count,
    0,
  );
});

test("Pickup comments reject missing targets and Collector moderation while Admin can read", async () => {
  const { db, collectorSecret, adminSecret } = await database();
  applyMigration(db, "0013_fc5_pickup_comments.sql");

  const missing = await handleCommentsApi(
    collectorRequest(collectorSecret, "collection_pickup_missing"),
    db,
  );
  assert.ok(missing);
  assert.equal(missing.status, 404);

  const created = await handleCommentsApi(createCollectorCommentRequest(collectorSecret), db);
  assert.ok(created);
  assert.equal(created.status, 201);
  const createdPayload = (await created.json()) as { comment: { updatedAt: string } };

  const edit = await handleCommentsApi(
    new Request(
      "https://flyer.test/api/campaigns/campaign_pickup_comments/comments/comment_pickup_runtime",
      {
        method: "PATCH",
        headers: {
          cookie: `vf_collection_session=${encodeURIComponent(collectorSecret)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Geändert",
          expectedUpdatedAt: createdPayload.comment.updatedAt,
          requestId: "pickup_comment_edit_attempt",
        }),
      },
    ),
    db,
  );
  assert.ok(edit);
  assert.equal(edit.status, 403);

  const adminRead = await handleCommentsApi(adminRequest(adminSecret), db);
  assert.ok(adminRead);
  assert.equal(adminRead.status, 200);
  const adminPayload = (await adminRead.json()) as { comments: Array<{ id: string; canEdit: boolean }> };
  assert.equal(adminPayload.comments[0]?.id, "comment_pickup_runtime");
  assert.equal(adminPayload.comments[0]?.canEdit, true);
});
