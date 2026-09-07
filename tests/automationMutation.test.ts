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
import productionWorker from "../worker/indexM55.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";

const migrationFiles = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0004_m6_task_source_provenance.sql",
  "0005_m6_house_tasks.sql",
  "0006_fc1_field_groups.sql",
  "0007_field_sessions_events.sql",
  "0008_comments.sql",
  "0009_automations.sql",
];

const originalTimestamp = "2026-08-28T10:00:00.000Z";
const mutationTimestamp = "2026-08-28T10:05:00.000Z";

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

type SeedOptions = {
  automationEnabled?: boolean;
  parentStatus?: "open" | "completed" | "later" | "not-deliverable";
  houseCount?: number;
  parentStreetTaskId?: string | null;
};

async function database(options: SeedOptions = {}) {
  const db = new SqliteD1();
  for (const file of migrationFiles) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const parentStatus = options.parentStatus ?? "open";
  const parentCompletedAt = parentStatus === "completed" ? originalTimestamp : null;
  const parentStreetTaskId = options.parentStreetTaskId === undefined
    ? "task_parent"
    : options.parentStreetTaskId;
  const houseCount = options.houseCount ?? 1;
  db.raw
    .prepare(
      `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
       VALUES (?, 'Automation', 'active', 0, 'write-token', ?, ?)`,
    )
    .run("campaign_automation_runtime", originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
       VALUES ('team_runtime', 'campaign_automation_runtime', 'Runtime Team', '#ea580c', ?, ?)`,
    )
    .run(originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at)
       VALUES ('area_runtime', 'campaign_automation_runtime', 'team_runtime', 'Gebiet', ?, ?, ?)`,
    )
    .run(
      '{"type":"Polygon","coordinates":[[[10,50],[10.1,50],[10.1,50.1],[10,50]]]}',
      originalTimestamp,
      originalTimestamp,
    );
  db.raw
    .prepare(
      `INSERT INTO tasks (
         id, campaign_id, area_id, task_type, label, geometry_json, source_json,
         status, completed_at, created_at, updated_at
       ) VALUES ('task_parent', 'campaign_automation_runtime', 'area_runtime', 'street',
         'Hauptstraße', ?, NULL, ?, ?, ?, ?)` ,
    )
    .run(
      '{"type":"LineString","coordinates":[[10,50],[10.1,50.1]]}',
      parentStatus,
      parentCompletedAt,
      originalTimestamp,
      originalTimestamp,
    );

  const houseGeometry = (index: number) =>
    JSON.stringify({
      type: "Polygon",
      coordinates: [[[10 + index / 1000, 50], [10.001 + index / 1000, 50], [10.001 + index / 1000, 50.001], [10 + index / 1000, 50]]],
    });
  for (let index = 0; index < houseCount; index += 1) {
    db.raw
      .prepare(
        `INSERT INTO house_tasks (
           id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
           status, completed_at, created_at, updated_at
         ) VALUES (?, 'campaign_automation_runtime', 'area_runtime', ?, ?, ?, NULL, 'open', NULL, ?, ?)`,
      )
      .run(
        `task_house_${index + 1}`,
        parentStreetTaskId,
        `Haus ${index + 1}`,
        houseGeometry(index),
        originalTimestamp,
        originalTimestamp,
      );
  }
  db.raw
    .prepare(
      `INSERT INTO automation_rules (campaign_id, rule_type, enabled, created_at, updated_at)
       VALUES (?, 'complete-parent-street-when-all-houses-complete', ?, ?, ?)`,
    )
    .run("campaign_automation_runtime", options.automationEnabled === false ? 0 : 1, originalTimestamp, originalTimestamp);
  return db;
}

let sequence = 0;

async function persistentAdmin(db: SqliteD1) {
  sequence += 1;
  const secret = `automation-runtime-session-${sequence}`;
  const grantId = `grant_runtime_${sequence}`;
  const sessionHash = await hashSecret(secret);
  const tokenHash = createHash("sha256").update(`${secret}-token`).digest("hex");
  db.raw
    .prepare(
      `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
       VALUES (?, 'campaign_automation_runtime', 'admin', NULL, ?, 'Runtime admin', ?, NULL)`,
    )
    .run(grantId, tokenHash, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
       VALUES (?, ?, 'campaign_automation_runtime', ?, ?, '2099-01-01T00:00:00.000Z')`,
    )
    .run(`session_runtime_${sequence}`, grantId, sessionHash, originalTimestamp);
  return { cookie: `vf_session=${secret}`, grantId };
}

async function addSessionAttribution(db: SqliteD1, grantId: string) {
  db.raw
    .prepare(
      `INSERT INTO field_groups (
         id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
         created_by_grant_id, create_request_id, create_payload_hash, created_at,
         hard_expires_at, closed_at, updated_at
       ) VALUES ('group_runtime', 'campaign_automation_runtime', 'team_runtime', 'Einsatz',
         'distribution', 1, 'active', 1, ?, 'create-runtime', 'payload-hash', ?,
         '2099-01-01T00:00:00.000Z', NULL, ?)`,
    )
    .run(grantId, originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships (
         id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
         joined_at, expires_at, left_at, removed_at
       ) VALUES ('membership_runtime', 'campaign_automation_runtime', 'group_runtime',
         'team_runtime', ?, NULL, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(grantId, originalTimestamp);
}

async function temporaryMember(db: SqliteD1) {
  sequence += 1;
  const secret = `automation-temporary-session-${sequence}`;
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO field_groups (
         id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
         created_by_grant_id, create_request_id, create_payload_hash, created_at,
         hard_expires_at, closed_at, updated_at
       ) VALUES ('group_runtime_temp', 'campaign_automation_runtime', 'team_runtime', 'Temporärer Einsatz',
         'distribution', 1, 'active', 1, NULL, 'create-runtime-temp', 'payload-hash-temp', ?,
         '2099-01-01T00:00:00.000Z', NULL, ?)` ,
    )
    .run(originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships (
         id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
         joined_at, expires_at, left_at, removed_at
       ) VALUES ('membership_runtime_temp', 'campaign_automation_runtime', 'group_runtime_temp',
         'team_runtime', NULL, ?, ?, '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(sessionHash, originalTimestamp);
  return "vf_field_group_session=" + secret;
}

function request(path: string, options: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://flyer.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function mutation(
  overrides: Partial<CampaignMutation["payload"]> = {},
): CampaignMutation {
  return {
    id: "mutation_runtime_house_1",
    campaignId: "campaign_automation_runtime",
    type: "house.set-status",
    payload: {
      taskId: "task_house_1",
      status: "completed",
      completedAt: "2026-08-28T10:04:00.000Z",
      expectedUpdatedAt: originalTimestamp,
      ...overrides,
    },
    baseRevision: 0,
    createdAt: mutationTimestamp,
  } as CampaignMutation;
}

async function runMutation(db: SqliteD1, cookie: string, input = mutation()) {
  return productionWorker.fetch(
    request("/api/campaigns/campaign_automation_runtime/mutations", {
      method: "POST",
      cookie,
      body: { mutation: input, fieldGroupId: null },
    }),
    { DB: db },
  );
}

function parent(db: SqliteD1) {
  const row = db.raw
    .prepare("SELECT status, completed_at, updated_at FROM tasks WHERE id = 'task_parent'")
    .get() as { status: string; completed_at: string | null; updated_at: string };
  return { ...row };
}

function events(db: SqliteD1) {
  return db.raw
    .prepare(
      `SELECT event_type, entity_type, entity_id, actor_kind, actor_ref, field_session_id, payload_json
       FROM domain_events
       ORDER BY rowid`,
    )
    .all() as Array<{
    event_type: string;
    entity_type: string;
    entity_id: string;
    actor_kind: string;
    actor_ref: string | null;
    field_session_id: string | null;
    payload_json: string;
  }>;
}

test("enabled last House completion atomically completes the open Parent Street and emits minimal system events", async () => {
  const db = await database();
  const admin = await persistentAdmin(db);
  const response = await runMutation(db, admin.cookie);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), {
    mutationId: "mutation_runtime_house_1",
    appliedRevision: 1,
    alreadyApplied: false,
  });
  assert.deepEqual(parent(db), {
    status: "completed",
    completed_at: mutationTimestamp,
    updated_at: mutationTimestamp,
  });

  const firstEvents = events(db);
  assert.equal(firstEvents.length, 3);
  assert.deepEqual(firstEvents.map((event) => event.event_type), [
    "task.status.changed",
    "task.status.changed",
    "automation.executed",
  ]);
  const parentEvent = firstEvents.find((event) => event.entity_id === "task_parent" && event.event_type === "task.status.changed");
  assert.ok(parentEvent);
  assert.equal(parentEvent.actor_kind, "system");
  assert.equal(parentEvent.actor_ref, null);
  assert.deepEqual(JSON.parse(parentEvent.payload_json), {
    previousStatus: "open",
    newStatus: "completed",
  });
  const automationEvent = firstEvents.find((event) => event.event_type === "automation.executed");
  assert.ok(automationEvent);
  assert.equal(automationEvent.actor_kind, "system");
  assert.equal(automationEvent.actor_ref, null);
  assert.deepEqual(JSON.parse(automationEvent.payload_json), {
    ruleType: "complete-parent-street-when-all-houses-complete",
    effectType: "complete-parent-street",
    triggerEntityId: "task_house_1",
  });
  assert.equal(firstEvents.some((event) => event.payload_json.includes("<script>")), false);

  const replay = await runMutation(db, admin.cookie);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {
    mutationId: "mutation_runtime_house_1",
    appliedRevision: 1,
    alreadyApplied: true,
  });
  assert.equal(events(db).length, 3);
  assert.deepEqual(parent(db), {
    status: "completed",
    completed_at: mutationTimestamp,
    updated_at: mutationTimestamp,
  });
});

test("the automatic events inherit one unambiguous triggering Field Session and do not invent one otherwise", async () => {
  const attributedDb = await database();
  const attributedAdmin = await persistentAdmin(attributedDb);
  await addSessionAttribution(attributedDb, attributedAdmin.grantId);
  await runMutation(attributedDb, attributedAdmin.cookie);
  const attributed = events(attributedDb).filter((event) =>
    event.entity_id === "task_parent" || event.entity_id === "task_house_1",
  );
  assert.equal(attributed.every((event) => event.field_session_id === "field_session_group_group_runtime"), true);

  const unattributedDb = await database();
  const unattributedAdmin = await persistentAdmin(unattributedDb);
  await runMutation(unattributedDb, unattributedAdmin.cookie);
  assert.equal(events(unattributedDb).every((event) => event.field_session_id === null), true);
});

test("a temporary Field-Group member may trigger the enabled effect without gaining management rights", async () => {
  const db = await database();
  const cookie = await temporaryMember(db);
  const response = await runMutation(db, cookie);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(parent(db).status, "completed");
  const persistedEvents = events(db);
  const houseEvent = persistedEvents.find((event) => event.entity_id === "task_house_1");
  const automaticEvents = persistedEvents.filter((event) => event.entity_id === "task_parent");
  assert.equal(houseEvent?.actor_kind, "temporary-member");
  assert.equal(houseEvent?.actor_ref, "membership_runtime_temp");
  assert.equal(automaticEvents.length, 2);
  assert.equal(automaticEvents.every((event) => event.actor_kind === "system" && event.actor_ref === null), true);
  assert.equal(automaticEvents.every((event) => event.field_session_id === "field_session_group_group_runtime_temp"), true);
});

test("disabled or conservative Parent conditions leave the Parent Street unchanged", async () => {
  const cases: Array<{ name: string; options: SeedOptions }> = [
    { name: "disabled", options: { automationEnabled: false } },
    { name: "another House is open", options: { houseCount: 2 } },
    { name: "Parent is later", options: { parentStatus: "later" } },
    { name: "Parent is not deliverable", options: { parentStatus: "not-deliverable" } },
    { name: "Parent is already completed", options: { parentStatus: "completed" } },
    { name: "House has no Parent", options: { parentStreetTaskId: null } },
  ];

  for (const currentCase of cases) {
    const db = await database(currentCase.options);
    const admin = await persistentAdmin(db);
    const response = await runMutation(db, admin.cookie);
    assert.equal(response.status, 200, `${currentCase.name}: ${JSON.stringify(await response.clone().json())}`);
    const currentParent = parent(db);
    if (currentCase.options.parentStatus === "completed") {
      assert.equal(currentParent.status, "completed", currentCase.name);
      assert.equal(currentParent.completed_at, originalTimestamp, currentCase.name);
    } else {
      assert.equal(currentParent.status, currentCase.options.parentStatus ?? "open", currentCase.name);
    }
    assert.equal(events(db).some((event) => event.event_type === "automation.executed"), false, currentCase.name);
    assert.equal(events(db).filter((event) => event.entity_id === "task_parent").length, 0, currentCase.name);
  }
});

test("a cross-Campaign Parent reference cannot produce a foreign automation effect", async () => {
  const db = await database({ parentStreetTaskId: null });
  db.raw
    .prepare(
      `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
       VALUES ('campaign_foreign', 'Foreign', 'active', 0, 'foreign-write', ?, ?)`,
    )
    .run(originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
       VALUES ('team_foreign', 'campaign_foreign', 'Foreign Team', '#2563eb', ?, ?)`,
    )
    .run(originalTimestamp, originalTimestamp);
  db.raw
    .prepare(
      `INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at)
       VALUES ('area_foreign', 'campaign_foreign', 'team_foreign', 'Foreign Area', ?, ?, ?)`,
    )
    .run(
      '{"type":"Polygon","coordinates":[[[11,50],[11.1,50],[11.1,50.1],[11,50]]]}',
      originalTimestamp,
      originalTimestamp,
    );
  db.raw
    .prepare(
      `INSERT INTO tasks (
         id, campaign_id, area_id, task_type, label, geometry_json, source_json,
         status, completed_at, created_at, updated_at
       ) VALUES ('task_foreign_parent', 'campaign_foreign', 'area_foreign', 'street',
         'Foreign Street', ?, NULL, 'open', NULL, ?, ?)`,
    )
    .run(
      '{"type":"LineString","coordinates":[[11,50],[11.1,50.1]]}',
      originalTimestamp,
      originalTimestamp,
    );
  db.raw
    .prepare("UPDATE house_tasks SET parent_street_task_id = 'task_foreign_parent' WHERE id = 'task_house_1'")
    .run();
  const admin = await persistentAdmin(db);
  const response = await runMutation(db, admin.cookie);
  assert.equal(response.status, 422, JSON.stringify(await response.clone().json()));
  assert.equal(events(db).some((event) => event.event_type === "automation.executed"), false);
  assert.equal(
    (db.raw.prepare("SELECT status FROM tasks WHERE id = 'task_foreign_parent'").get() as { status: string }).status,
    "open",
  );
});
