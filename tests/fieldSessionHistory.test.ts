import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/indexM55.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from "../worker/campaignRepository.ts";
import { hasFieldSessionHistorySchema } from "../worker/fieldSessionHistory.ts";

const sessionColumns = [
  "id",
  "campaign_id",
  "team_id",
  "field_group_id",
  "started_at",
  "ended_at",
  "end_reason",
  "duration_seconds",
  "participant_count",
  "person_seconds",
  "status",
];

const eventColumns = [
  "id",
  "campaign_id",
  "field_session_id",
  "entity_type",
  "entity_id",
  "event_type",
  "dedupe_key",
];

class SchemaStatement implements D1PreparedStatement {
  constructor(
    readonly query: string,
    readonly tables: Record<string, string[]>,
  ) {}

  bind() {
    return this;
  }

  async first<T>() {
    return null as T | null;
  }

  async all<T>() {
    const match = this.query.match(/^PRAGMA table_info\(([^)]+)\)$/u);
    const rows = match ? (this.tables[match[1]] ?? []).map((name) => ({ name })) : [];
    return { results: rows as T[] };
  }
}

class SchemaDb implements D1DatabaseLike {
  constructor(readonly tables: Record<string, string[]>) {}

  prepare(query: string) {
    return new SchemaStatement(query, this.tables);
  }

  async batch() {
    return [];
  }
}

test("field session history schema requires both complete session and event tables", async () => {
  const complete = new SchemaDb({
    field_sessions: sessionColumns,
    domain_events: eventColumns,
  });
  assert.equal(await hasFieldSessionHistorySchema(complete), true);

  const missingEvents = new SchemaDb({ field_sessions: sessionColumns });
  assert.equal(await hasFieldSessionHistorySchema(missingEvents), false);

  const incompleteSessions = new SchemaDb({
    field_sessions: sessionColumns.filter((column) => column !== "end_reason"),
    domain_events: eventColumns,
  });
  assert.equal(await hasFieldSessionHistorySchema(incompleteSessions), false);
});

test("field group close fails before authorization or mutation when migration 0007 is absent", async () => {
  const db = new SchemaDb({});
  const response = await worker.fetch(
    new Request(
      "https://flyer.test/api/campaigns/campaign_a/field-groups/field_group_a/close",
      {
        method: "POST",
        headers: {
          origin: "https://flyer.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ participantCount: 4 }),
      },
    ),
    { DB: db },
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "field_session_schema_unavailable");
});

test("migration 0007 binds manual close to one durable session and one deduplicated event", async () => {
  const sql = await readFile("migrations/0007_field_sessions_events.sql", "utf8");

  assert.match(sql, /CREATE TABLE field_sessions/u);
  assert.match(sql, /CREATE TABLE domain_events/u);
  assert.match(sql, /end_reason TEXT/u);
  assert.match(sql, /UNIQUE \(campaign_id, field_group_id\)/u);
  assert.match(sql, /UNIQUE \(campaign_id, dedupe_key\)/u);
  assert.match(sql, /CREATE TRIGGER trg_field_group_close_history/u);
  assert.match(sql, /OLD\.state = 'active' AND NEW\.state = 'closed'/u);
  assert.match(sql, /'field_session_group_' \|\| NEW\.id/u);
  assert.match(sql, /'manual-close'/u);
  assert.match(sql, /'field_session\.closed'/u);
  assert.match(sql, /person_seconds/u);
  assert.match(sql, /INSERT OR IGNORE INTO field_sessions/u);
  assert.match(sql, /g\.state IN \('closed', 'expired'\)/u);

  assert.doesNotMatch(sql, /latitude|longitude|gps|route_polyline|session_secret|qr_token|room_code/iu);
});

test("migration 0007 retains expired groups without inventing missing person-time", async () => {
  const sql = await readFile("migrations/0007_field_sessions_events.sql", "utf8");

  assert.match(sql, /CREATE TRIGGER trg_field_group_expiry_history/u);
  assert.match(sql, /OLD\.state = 'active' AND NEW\.state = 'expired'/u);
  assert.match(sql, /'group-expired'/u);
  assert.match(sql, /'field_session\.expired'/u);
  assert.match(sql, /WHEN NEW\.participant_count IS NULL THEN NULL/u);
  assert.match(sql, /actor_kind[\s\S]*'system'/u);
});
