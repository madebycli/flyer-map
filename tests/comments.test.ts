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
  handleCommentsApi,
  parseCommentsRoute,
} from "../worker/comments.ts";
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

async function database() {
  const db = new SqliteD1();
  for (const file of migrationFiles) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const timestamp = "2026-08-28T10:00:00.000Z";
  db.raw.exec(`
    INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
    VALUES
      ('campaign_comments', 'Kommentare', 'active', 0, 'internal-write-token-a', '${timestamp}', '${timestamp}'),
      ('campaign_other', 'Andere Campaign', 'active', 0, 'internal-write-token-b', '${timestamp}', '${timestamp}');
    INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES
      ('team_a', 'campaign_comments', 'Team A', '#ea580c', '${timestamp}', '${timestamp}'),
      ('team_b', 'campaign_comments', 'Team B', '#2563eb', '${timestamp}', '${timestamp}'),
      ('team_other', 'campaign_other', 'Other Team', '#16a34a', '${timestamp}', '${timestamp}');
    INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES
      ('area_a', 'campaign_comments', 'team_a', 'Gebiet A', '{"type":"Polygon","coordinates":[[[10,50],[10.1,50],[10.1,50.1],[10,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_b', 'campaign_comments', 'team_b', 'Gebiet B', '{"type":"Polygon","coordinates":[[[11,50],[11.1,50],[11.1,50.1],[11,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_other', 'campaign_other', 'team_other', 'Fremdes Gebiet', '{"type":"Polygon","coordinates":[[[12,50],[12.1,50],[12.1,50.1],[12,50]]]}', '${timestamp}', '${timestamp}');
    INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('street_a', 'campaign_comments', 'area_a', 'street', 'Straße A', '{"type":"LineString","coordinates":[[10,50],[10.1,50.1]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}');
    INSERT INTO house_tasks (id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('house_a', 'campaign_comments', 'area_a', 'street_a', 'Haus A', '{"type":"Polygon","coordinates":[[[10,50],[10.01,50],[10.01,50.01],[10,50]]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}');
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
  const secret = `${role}-session-${sequence}`;
  const grantId = `grant_${role}_${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const tokenHash = createHash("sha256").update(`${secret}-token`).digest("hex");
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
       VALUES (?, 'campaign_comments', ?, ?, ?, ?, ?, NULL)`,
    )
    .run(grantId, role, teamId, tokenHash, `${role} test`, timestamp);
  db.raw
    .prepare(
      `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
       VALUES (?, ?, 'campaign_comments', ?, ?, '2099-01-01T00:00:00.000Z')`,
    )
    .run(`session_${sequence}`, grantId, sessionHash, timestamp);
  return `vf_session=${secret}`;
}

async function temporaryAccess(db: SqliteD1, teamId = "team_a", groupId = "group_a") {
  sequence += 1;
  const secret = `temporary-session-${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO field_groups
       (id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
        created_by_grant_id, create_request_id, create_payload_hash, created_at,
        hard_expires_at, closed_at, updated_at)
       VALUES (?, 'campaign_comments', ?, 'Temporäre Gruppe', 'distribution', 1, 'active', 1,
        NULL, ?, ?, ?, '2099-01-01T00:00:00.000Z', NULL, ?)`,
    )
    .run(groupId, teamId, `create_${sequence}`, "hash", timestamp, timestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships
       (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
        joined_at, expires_at, left_at, removed_at)
       VALUES (?, 'campaign_comments', ?, ?, NULL, ?, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(`membership_${sequence}`, groupId, teamId, sessionHash, timestamp);
  return `vf_field_group_session=${secret}`;
}

function request(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    origin?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`https://flyer.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, any>;
}

async function eventRows(db: SqliteD1, eventType?: string) {
  const statement = eventType
    ? db.raw.prepare("SELECT event_type, payload_json FROM domain_events WHERE entity_type = 'comment' AND event_type = ?")
    : db.raw.prepare("SELECT event_type, payload_json FROM domain_events WHERE entity_type = 'comment'");
  return (eventType ? statement.all(eventType) : statement.all()) as Array<{ event_type: string; payload_json: string }>;
}

test("comment route and additive migration are explicit", () => {
  assert.deepEqual(
    parseCommentsRoute("/api/campaigns/campaign_comments/comments"),
    { campaignId: "campaign_comments", commentId: null },
  );
  assert.deepEqual(
    parseCommentsRoute("/api/campaigns/campaign_comments/comments/comment_a"),
    { campaignId: "campaign_comments", commentId: "comment_a" },
  );
  assert.equal(parseCommentsRoute("/api/campaigns/%2F/comments"), null);
  assert.equal(parseCommentsRoute("/api/campaigns/campaign_comments/comments/%2F"), null);

  const migration = readFileSync(new URL("../migrations/0008_comments.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE comments/u);
  assert.match(migration, /target_type/u);
  assert.match(migration, /deleted_at/u);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+comments/iu);
});

test("unauthenticated and viewer writes fail closed", async () => {
  const db = await database();
  const unauthenticated = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a"),
    db,
  );
  assert.equal(unauthenticated?.status, 401);

  const viewer = await persistentAccess(db, "viewer");
  const response = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: viewer,
      body: { targetType: "area", targetId: "area_a", body: "Nicht erlaubt" },
    }),
    db,
  );
  assert.equal(response?.status, 403);
  assert.equal((await payload(response!)).error.code, "viewer_read_only");
});

test("Team Editor and temporary member remain inside their current team scope", async () => {
  const db = await database();
  const editor = await persistentAccess(db, "team-editor", "team_a");
  assert.equal(
    (
      await handleCommentsApi(
        request("/api/campaigns/campaign_comments/comments", {
          method: "POST",
          cookie: editor,
          body: { commentId: "comment_editor_own", targetType: "area", targetId: "area_a", body: "Eigener Scope" },
        }),
        db,
      )
    )?.status,
    201,
  );
  const foreignEditor = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: editor,
      body: { targetType: "area", targetId: "area_b", body: "Fremder Scope" },
    }),
    db,
  );
  assert.equal(foreignEditor?.status, 403);

  const temporary = await temporaryAccess(db);
  const temporaryOwn = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: temporary,
      body: { commentId: "comment_temp_own", targetType: "street-task", targetId: "street_a", body: "Temporärer Hinweis" },
    }),
    db,
  );
  assert.equal(temporaryOwn?.status, 201);
  const temporaryForeign = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: temporary,
      body: { targetType: "area", targetId: "area_b", body: "Außerhalb" },
    }),
    db,
  );
  assert.equal(temporaryForeign?.status, 403);

  const crossCampaign = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: editor,
      body: { targetType: "area", targetId: "area_other", body: "Cross Campaign" },
    }),
    db,
  );
  assert.equal(crossCampaign?.status, 404);

  const crossCampaignCampaignTarget = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: editor,
      body: { targetType: "campaign", targetId: "campaign_other", body: "Fremde Campaign" },
    }),
    db,
  );
  assert.equal(crossCampaignCampaignTarget?.status, 404);
});

test("create, edit and soft delete are durable and event-deduplicated", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");
  const createdResponse = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      body: {
        commentId: "comment_lifecycle",
        targetType: "area",
        targetId: "area_a",
        body: "  <script>alert(1)</script>'; DROP TABLE comments; --  ",
      },
    }),
    db,
  );
  assert.equal(createdResponse?.status, 201);
  const created = (await payload(createdResponse!)).comment;
  assert.equal(created.body, "<script>alert(1)</script>'; DROP TABLE comments; --");
  assert.equal((await eventRows(db)).length, 1);
  assert.equal((await eventRows(db))[0].payload_json.includes("DROP TABLE"), false);

  const retriedCreate = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      body: {
        commentId: "comment_lifecycle",
        targetType: "area",
        targetId: "area_a",
        body: "<script>alert(1)</script>'; DROP TABLE comments; --",
      },
    }),
    db,
  );
  assert.equal(retriedCreate?.status, 200);
  assert.equal((await payload(retriedCreate!)).alreadyCreated, true);
  assert.equal((await eventRows(db)).length, 1);

  const editor = await persistentAccess(db, "team-editor", "team_a");
  const editedResponse = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments/comment_lifecycle", {
      method: "PATCH",
      cookie: editor,
      body: {
        body: "Bearbeitet",
        expectedUpdatedAt: created.updatedAt,
        requestId: "edit:comment_lifecycle:one",
      },
    }),
    db,
  );
  assert.equal(editedResponse?.status, 200);
  const edited = (await payload(editedResponse!)).comment;
  assert.equal(edited.body, "Bearbeitet");
  assert.equal(edited.version, 2);
  const retriedEdit = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments/comment_lifecycle", {
      method: "PATCH",
      cookie: editor,
      body: {
        body: "Bearbeitet",
        expectedUpdatedAt: created.updatedAt,
        requestId: "edit:comment_lifecycle:one",
      },
    }),
    db,
  );
  assert.equal(retriedEdit?.status, 200);
  assert.equal((await payload(retriedEdit!)).alreadyEdited, true);
  assert.equal((await eventRows(db, "comment.edited")).length, 1);

  const deletedResponse = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments/comment_lifecycle", {
      method: "DELETE",
      cookie: editor,
      body: { requestId: "delete:comment_lifecycle" },
    }),
    db,
  );
  assert.equal(deletedResponse?.status, 200);
  const deleted = (await payload(deletedResponse!)).comment;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.body, null);
  const stored = db.raw.prepare("SELECT body, deleted_at FROM comments WHERE id = ?").get("comment_lifecycle") as { body: string | null; deleted_at: string | null };
  assert.equal(stored.body, null);
  assert.ok(stored.deleted_at);
  assert.equal((await eventRows(db, "comment.deleted")).length, 1);

  const retriedDelete = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments/comment_lifecycle", {
      method: "DELETE",
      cookie: editor,
      body: { requestId: "delete:comment_lifecycle" },
    }),
    db,
  );
  assert.equal(retriedDelete?.status, 200);
  assert.equal((await payload(retriedDelete!)).alreadyDeleted, true);
  assert.equal((await eventRows(db, "comment.deleted")).length, 1);

  const editDeleted = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments/comment_lifecycle", {
      method: "PATCH",
      cookie: admin,
      body: { body: "Wieder da", expectedUpdatedAt: deleted.updatedAt },
    }),
    db,
  );
  assert.equal(editDeleted?.status, 409);
});

test("comment body validation, inert text and invalid targets stay bounded", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");
  const tooLong = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      body: { targetType: "area", targetId: "area_a", body: "x".repeat(2_001) },
    }),
    db,
  );
  assert.equal(tooLong?.status, 422);
  const invalidTarget = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      body: { targetType: "area", targetId: "missing_area", body: "Text" },
    }),
    db,
  );
  assert.equal(invalidTarget?.status, 404);
  const invalidType = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments?targetType=pickup&targetId=pickup_a", { cookie: admin }),
    db,
  );
  assert.equal(invalidType?.status, 400);
});

test("comment lists are bounded and cursor-paginated", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");
  for (const id of ["comment_page_a", "comment_page_b", "comment_page_c"]) {
    const response = await handleCommentsApi(
      request("/api/campaigns/campaign_comments/comments", {
        method: "POST",
        cookie: admin,
        body: { commentId: id, targetType: "area", targetId: "area_a", body: id },
      }),
      db,
    );
    assert.equal(response?.status, 201);
  }

  const first = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a&limit=2", { cookie: admin }),
    db,
  );
  assert.equal(first?.status, 200);
  const firstPage = await payload(first!);
  assert.equal(firstPage.comments.length, 2);
  assert.ok(firstPage.nextCursor);

  const second = await handleCommentsApi(
    request(
      `/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      { cookie: admin },
    ),
    db,
  );
  assert.equal(second?.status, 200);
  const secondPage = await payload(second!);
  assert.equal(secondPage.comments.length, 1);
  assert.equal(firstPage.comments.some((comment: { id: string }) => comment.id === secondPage.comments[0].id), false);

  assert.equal(
    (
      await handleCommentsApi(
        request("/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a&limit=51", { cookie: admin }),
        db,
      )
    )?.status,
    400,
  );
  assert.equal(
    (
      await handleCommentsApi(
        request("/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a&cursor=broken", { cookie: admin }),
        db,
      )
    )?.status,
    400,
  );
});

test("deleted targets fail closed while comment metadata remains", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");
  const created = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      body: { commentId: "comment_deleted_target", targetType: "area", targetId: "area_a", body: "Historischer Hinweis" },
    }),
    db,
  );
  assert.equal(created?.status, 201);
  db.raw.prepare("DELETE FROM areas WHERE id = ? AND campaign_id = ?").run("area_a", "campaign_comments");

  const listed = await handleCommentsApi(
    request("/api/campaigns/campaign_comments/comments?targetType=area&targetId=area_a", { cookie: admin }),
    db,
  );
  assert.equal(listed?.status, 404);
  const retained = db.raw.prepare("SELECT id FROM comments WHERE id = ? AND campaign_id = ?").get("comment_deleted_target", "campaign_comments");
  assert.ok(retained);
});

test("production Worker rejects cross-origin comment writes at the authoritative boundary", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");
  const response = await productionWorker.fetch(
    request("/api/campaigns/campaign_comments/comments", {
      method: "POST",
      cookie: admin,
      origin: "https://evil.example",
      body: { targetType: "area", targetId: "area_a", body: "Cross origin" },
    }),
    { DB: db },
  );
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error.code, "origin_forbidden");
});

test("production UI path renders durable comments in real context surfaces", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const launcher = readFileSync(new URL("../src/platform/platformContract.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/collaboration/CommentsPanel.tsx", import.meta.url), "utf8");
  assert.match(app, /CommentsContextPanel/u);
  assert.match(app, /targetType="area"/u);
  assert.match(app, /targetType="street-task"/u);
  assert.match(app, /targetType="house-task"/u);
  assert.match(app, /targetType="campaign"/u);
  assert.match(launcher, /open-campaign-comments/u);
  assert.match(panel, /<p[^>]*>\s*\{comment\.deleted/u);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML/u);
});
