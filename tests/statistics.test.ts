import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  handleStatisticsApi,
  hasStatisticsSchema,
  parseStatisticsRoute,
} from "../worker/statistics.ts";
import productionWorker from "../worker/indexM55.ts";
import { hashSecret } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

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

const now = () => new Date().toISOString();
let sequence = 0;

async function database(withStatsSchema = true) {
  const db = new SqliteD1();
  const files = withStatsSchema ? migrationFiles : migrationFiles.slice(0, 6);
  for (const file of files) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const timestamp = now();
  db.raw.exec(`
    INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
    VALUES
      ('campaign_stats', 'Stats', 'active', 0, 'internal-write-token-stats', '${timestamp}', '${timestamp}'),
      ('campaign_other_stats', 'Andere Stats', 'active', 0, 'internal-write-token-other', '${timestamp}', '${timestamp}');
    INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES
      ('team_stats_a', 'campaign_stats', 'Team A', '#ea580c', '${timestamp}', '${timestamp}'),
      ('team_stats_b', 'campaign_stats', 'Team B', '#2563eb', '${timestamp}', '${timestamp}'),
      ('team_stats_other', 'campaign_other_stats', 'Fremdes Team', '#16a34a', '${timestamp}', '${timestamp}');
    INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES
      ('area_stats_a', 'campaign_stats', 'team_stats_a', 'Gebiet A', '{"type":"Polygon","coordinates":[[[10,50],[10.1,50],[10.1,50.1],[10,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_stats_b', 'campaign_stats', 'team_stats_b', 'Gebiet B', '{"type":"Polygon","coordinates":[[[11,50],[11.1,50],[11.1,50.1],[11,50]]]}', '${timestamp}', '${timestamp}'),
      ('area_stats_other', 'campaign_other_stats', 'team_stats_other', 'Fremdes Gebiet', '{"type":"Polygon","coordinates":[[[12,50],[12.1,50],[12.1,50.1],[12,50]]]}', '${timestamp}', '${timestamp}');
    INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('street_stats_a1', 'campaign_stats', 'area_stats_a', 'street', 'Hauptstraße', '{"type":"LineString","coordinates":[[10,50],[10.1,50.1]]}', NULL, 'completed', '${timestamp}', '${timestamp}', '${timestamp}'),
      ('street_stats_a2', 'campaign_stats', 'area_stats_a', 'street', 'Nebenstraße', '{"type":"LineString","coordinates":[[10,50.2],[10.1,50.3]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}'),
      ('street_stats_b1', 'campaign_stats', 'area_stats_b', 'street', 'Bergstraße', '{"type":"LineString","coordinates":[[11,50],[11.1,50.1]]}', NULL, 'later', NULL, '${timestamp}', '${timestamp}');
    INSERT INTO house_tasks (id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json, status, completed_at, created_at, updated_at) VALUES
      ('house_stats_a1', 'campaign_stats', 'area_stats_a', 'street_stats_a1', 'Haus A', '{"type":"Polygon","coordinates":[[[10,50],[10.01,50],[10.01,50.01],[10,50]]]}', NULL, 'completed', '${timestamp}', '${timestamp}', '${timestamp}'),
      ('house_stats_a2', 'campaign_stats', 'area_stats_a', 'street_stats_a1', 'Haus B', '{"type":"Polygon","coordinates":[[[10.02,50],[10.03,50],[10.03,50.01],[10.02,50]]]}', NULL, 'open', NULL, '${timestamp}', '${timestamp}');
  `);
  return db;
}

async function persistentAccess(
  db: SqliteD1,
  role: "admin" | "team-editor" | "viewer",
  teamId: string | null = null,
) {
  sequence += 1;
  const secret = `${role}-stats-session-${sequence}`;
  const grantId = `grant_stats_${role}_${sequence}`;
  const timestamp = now();
  const tokenHash = createHash("sha256").update(`${secret}-token`).digest("hex");
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
       VALUES (?, 'campaign_stats', ?, ?, ?, ?, ?, NULL)`,
    )
    .run(grantId, role, teamId, tokenHash, `${role} stats test`, timestamp);
  db.raw
    .prepare(
      `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
       VALUES (?, ?, 'campaign_stats', ?, ?, '2099-01-01T00:00:00.000Z')`,
    )
    .run(`session_stats_${sequence}`, grantId, sessionHash, timestamp);
  return `vf_session=${secret}`;
}

async function temporaryAccess(db: SqliteD1) {
  sequence += 1;
  const secret = `temporary-stats-session-${sequence}`;
  const timestamp = now();
  const groupId = `group_stats_${sequence}`;
  const membershipId = `membership_stats_${sequence}`;
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO field_groups
       (id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
        created_by_grant_id, create_request_id, create_payload_hash, created_at,
        hard_expires_at, closed_at, updated_at)
       VALUES (?, 'campaign_stats', 'team_stats_a', 'Temporäre Gruppe', 'distribution', 1, 'active', 2,
        NULL, ?, ?, ?, '2099-01-01T00:00:00.000Z', NULL, ?)`,
    )
    .run(groupId, `stats_create_${sequence}`, "stats-hash", timestamp, timestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships
       (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
        joined_at, expires_at, left_at, removed_at)
       VALUES (?, 'campaign_stats', ?, 'team_stats_a', NULL, ?, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(membershipId, groupId, sessionHash, timestamp);
  return {
    cookie: `vf_field_group_session=${secret}`,
    groupId,
    sessionId: `field_session_group_${groupId}`,
  };
}

function request(path: string, options: { method?: string; cookie?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`https://flyer.test${path}`, {
    method: options.method ?? "GET",
    headers,
  });
}

function insertSession(
  db: SqliteD1,
  input: { id: string; teamId: string; startedAt: string; mode?: "distribution" | "collection" },
) {
  db.raw
    .prepare(
      `INSERT INTO field_sessions (
        id, campaign_id, team_id, field_group_id, mode, started_at, ended_at,
        end_reason, duration_seconds, participant_count, person_seconds, note,
        status, created_at, updated_at
      ) VALUES (?, 'campaign_stats', ?, NULL, ?, ?, ?, 'manual-close', 1800, 2, 3600, NULL, 'closed', ?, ?)`,
    )
    .run(input.id, input.teamId, input.mode ?? "distribution", input.startedAt, input.startedAt, input.startedAt, input.startedAt);
}

function insertEvent(
  db: SqliteD1,
  input: {
    id: string;
    teamId?: string | null;
    fieldSessionId?: string | null;
    entityType: string;
    entityId: string;
    eventType: string;
    occurredAt: string;
    payload?: string;
  },
) {
  db.raw
    .prepare(
      `INSERT INTO domain_events (
        id, campaign_id, team_id, field_session_id, entity_type, entity_id,
        event_type, occurred_at, actor_kind, actor_ref, payload_version,
        payload_json, dedupe_key, created_at
      ) VALUES (?, 'campaign_stats', ?, ?, ?, ?, ?, ?, 'campaign-grant', 'internal-actor', 1, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.teamId ?? null,
      input.fieldSessionId ?? null,
      input.entityType,
      input.entityId,
      input.eventType,
      input.occurredAt,
      input.payload ?? "{}",
      `stats:${input.id}`,
      input.occurredAt,
    );
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, any>;
}

test("Stats route and migration availability are explicit", async () => {
  assert.deepEqual(parseStatisticsRoute("/api/campaigns/campaign_stats/stats"), {
    campaignId: "campaign_stats",
  });
  assert.equal(parseStatisticsRoute("/api/campaigns/%2F/stats"), null);

  const db = await database();
  assert.equal(await hasStatisticsSchema(db), true);
  assert.equal(await hasStatisticsSchema(await database(false)), false);
  assert.equal(
    (await handleStatisticsApi(request("/api/campaigns/campaign_stats/stats"), db))?.status,
    401,
  );

  const schemaMissing = await database(false);
  const admin = await persistentAccess(schemaMissing, "admin");
  const response = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: admin }),
    schemaMissing,
  );
  assert.equal(response?.status, 503);
  assert.equal((await payload(response!)).error.code, "statistics_schema_unavailable");
});

test("admin and viewer receive real campaign progress with separate denominators and session metrics", async () => {
  const db = await database();
  insertSession(db, {
    id: "session_stats_distribution",
    teamId: "team_stats_a",
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  insertSession(db, {
    id: "session_stats_collection",
    teamId: "team_stats_b",
    mode: "collection",
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
  });
  insertEvent(db, {
    id: "event_stats_completed",
    teamId: "team_stats_a",
    fieldSessionId: "session_stats_distribution",
    entityType: "street-task",
    entityId: "street_stats_a1",
    eventType: "task.status.changed",
    occurredAt: new Date(Date.now() - 1_800_000).toISOString(),
    payload: JSON.stringify({ previousStatus: "open", newStatus: "completed", secret: "do-not-return" }),
  });

  const admin = await persistentAccess(db, "admin");
  const response = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: admin }),
    db,
  );
  assert.equal(response?.status, 200);
  const result = await payload(response!);
  assert.equal(result.scope.kind, "campaign");
  assert.equal(result.campaign.streets.denominator, "street-tasks");
  assert.deepEqual(
    {
      total: result.campaign.streets.total,
      completed: result.campaign.streets.completed,
      open: result.campaign.streets.open,
      later: result.campaign.streets.later,
    },
    { total: 3, completed: 1, open: 1, later: 1 },
  );
  assert.equal(result.campaign.houses.denominator, "house-tasks");
  assert.equal(result.campaign.houses.total, 2);
  assert.equal(result.sessions.distribution.outings, 1);
  assert.equal(result.sessions.distribution.totalDurationSeconds, 1800);
  assert.equal(result.sessions.distribution.participantCountTotal, 2);
  assert.equal(result.sessions.distribution.totalPersonSeconds, 3600);
  assert.equal(result.sessions.collection.outings, 1);
  assert.equal(result.sessions.collection.totalDurationSeconds, 1800);
  assert.equal(result.recentSessions.length, 2);
  assert.equal(result.progressOverTime.at(-1).completedTransitions, 1);
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
  assert.equal(JSON.stringify(result).includes("payload_json"), false);

  const viewer = await persistentAccess(db, "viewer");
  const viewerResponse = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: viewer }),
    db,
  );
  assert.equal(viewerResponse?.status, 200);
  assert.equal((await payload(viewerResponse!)).campaign.streets.total, 3);
});

test("team, temporary-group and cross-campaign scopes fail closed", async () => {
  const db = await database();
  const foreignTeamSession = "session_stats_foreign_team_same_campaign";
  insertSession(db, {
    id: foreignTeamSession,
    teamId: "team_stats_b",
    startedAt: new Date(Date.now() - 1_200_000).toISOString(),
  });
  const temporary = await temporaryAccess(db);
  insertEvent(db, {
    id: "event_stats_temp_own",
    teamId: "team_stats_a",
    fieldSessionId: temporary.sessionId,
    entityType: "street-task",
    entityId: "street_stats_a1",
    eventType: "task.status.changed",
    occurredAt: new Date(Date.now() - 900_000).toISOString(),
    payload: JSON.stringify({ previousStatus: "open", newStatus: "completed" }),
  });
  insertEvent(db, {
    id: "event_stats_temp_other_session",
    teamId: "team_stats_a",
    fieldSessionId: foreignTeamSession,
    entityType: "street-task",
    entityId: "street_stats_a2",
    eventType: "task.status.changed",
    occurredAt: new Date(Date.now() - 800_000).toISOString(),
  });

  const editor = await persistentAccess(db, "team-editor", "team_stats_a");
  const editorResponse = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: editor }),
    db,
  );
  assert.equal(editorResponse?.status, 200);
  const editorResult = await payload(editorResponse!);
  assert.equal(editorResult.scope.kind, "team");
  assert.equal(editorResult.campaign, null);
  assert.deepEqual(editorResult.teams.map((team: any) => team.teamId), ["team_stats_a"]);
  assert.equal(editorResult.areas.some((area: any) => area.teamId === "team_stats_b"), false);
  assert.equal(
    (
      await handleStatisticsApi(
        request("/api/campaigns/campaign_stats/stats?team=team_stats_b", { cookie: editor }),
        db,
      )
    )?.status,
    403,
  );

  const temporaryResponse = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: temporary.cookie }),
    db,
  );
  assert.equal(temporaryResponse?.status, 200);
  const temporaryResult = await payload(temporaryResponse!);
  assert.equal(temporaryResult.scope.kind, "field-group");
  assert.deepEqual(temporaryResult.recentSessions.map((session: any) => session.id), [temporary.sessionId]);
  assert.equal(temporaryResult.progressOverTime.length, 1);
  assert.equal(temporaryResult.progressOverTime[0].statusChanges, 1);
  assert.equal(
    (
      await handleStatisticsApi(
        request("/api/campaigns/campaign_stats/stats?team=team_stats_b", { cookie: temporary.cookie }),
        db,
      )
    )?.status,
    403,
  );

  assert.equal(
    (
      await handleStatisticsApi(
        request("/api/campaigns/campaign_other_stats/stats", { cookie: editor }),
        db,
      )
    )?.status,
    401,
  );
});

test("Stats keeps the recent session list bounded and cross-origin writes remain blocked", async () => {
  const db = await database();
  for (let index = 0; index < 21; index += 1) {
    insertSession(db, {
      id: `session_stats_page_${String(index).padStart(2, "0")}`,
      teamId: "team_stats_a",
      startedAt: new Date(Date.now() - index * 60_000).toISOString(),
    });
  }
  const admin = await persistentAccess(db, "admin");
  const response = await handleStatisticsApi(
    request("/api/campaigns/campaign_stats/stats", { cookie: admin }),
    db,
  );
  const result = await payload(response!);
  assert.equal(response?.status, 200);
  assert.equal(result.recentSessions.length, 20);
  assert.equal(result.recentSessionsTruncated, true);

  const crossOrigin = await productionWorker.fetch(
    request("/api/campaigns/campaign_stats/stats", {
      method: "POST",
      cookie: admin,
      origin: "https://evil.example",
    }),
    { DB: db },
  );
  assert.equal(crossOrigin.status, 403);
});
