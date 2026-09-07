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
  COMPLETE_PARENT_STREET_RULE_TYPE,
  AUTOMATION_REGISTRY,
} from "../src/domain/automations.ts";
import {
  handleAutomationsApi,
  parseAutomationsRoute,
} from "../worker/automationConfig.ts";
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
  "0009_automations.sql",
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

async function database(withAutomationSchema = true) {
  const db = new SqliteD1();
  const files = withAutomationSchema ? migrationFiles : migrationFiles.slice(0, -1);
  for (const file of files) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const timestamp = "2026-08-28T10:00:00.000Z";
  db.raw.exec(`
    INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
    VALUES
      ('campaign_automation', 'Automation', 'active', 0, 'write-a', '${timestamp}', '${timestamp}'),
      ('campaign_automation_other', 'Andere Campaign', 'active', 0, 'write-b', '${timestamp}', '${timestamp}');
    INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES
      ('team_automation', 'campaign_automation', 'Team Automation', '#ea580c', '${timestamp}', '${timestamp}'),
      ('team_other', 'campaign_automation_other', 'Other Team', '#2563eb', '${timestamp}', '${timestamp}');
  `);
  return db;
}

let sequence = 0;

async function persistentAccess(
  db: SqliteD1,
  role: "admin" | "team-editor" | "viewer",
  campaignId = "campaign_automation",
  teamId: string | null = null,
) {
  sequence += 1;
  const secret = `${role}-automation-session-${sequence}`;
  const grantId = `grant_automation_${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const tokenHash = createHash("sha256").update(`${secret}-token`).digest("hex");
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(grantId, campaignId, role, teamId, tokenHash, `${role} test`, timestamp);
  db.raw
    .prepare(
      `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, '2099-01-01T00:00:00.000Z')`,
    )
    .run(`session_automation_${sequence}`, grantId, campaignId, sessionHash, timestamp);
  return `vf_session=${secret}`;
}

async function temporaryAccess(db: SqliteD1) {
  sequence += 1;
  const secret = `temporary-automation-session-${sequence}`;
  const timestamp = "2026-08-28T10:00:00.000Z";
  const sessionHash = await hashSecret(secret);
  db.raw
    .prepare(
      `INSERT INTO field_groups
       (id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
        created_by_grant_id, create_request_id, create_payload_hash, created_at,
        hard_expires_at, closed_at, updated_at)
       VALUES (?, 'campaign_automation', 'team_automation', 'Temp', 'distribution', 1, 'active', 1,
        NULL, ?, ?, ?, '2099-01-01T00:00:00.000Z', NULL, ?)`,
    )
    .run(`group_automation_${sequence}`, `create_${sequence}`, "hash", timestamp, timestamp);
  db.raw
    .prepare(
      `INSERT INTO field_group_memberships
       (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
        joined_at, expires_at, left_at, removed_at)
       VALUES (?, 'campaign_automation', ?, 'team_automation', NULL, ?, ?,
        '2099-01-01T00:00:00.000Z', NULL, NULL)`,
    )
    .run(`membership_automation_${sequence}`, `group_automation_${sequence}`, sessionHash, timestamp);
  return `vf_field_group_session=${secret}`;
}

function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown; origin?: string } = {},
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

test("automation registry and migration are explicit and additive", () => {
  assert.deepEqual(parseAutomationsRoute("/api/campaigns/campaign_automation/automations"), {
    campaignId: "campaign_automation",
    ruleType: null,
  });
  assert.deepEqual(
    parseAutomationsRoute(
      `/api/campaigns/campaign_automation/automations/${COMPLETE_PARENT_STREET_RULE_TYPE}`,
    ),
    { campaignId: "campaign_automation", ruleType: COMPLETE_PARENT_STREET_RULE_TYPE },
  );
  assert.equal(parseAutomationsRoute("/api/campaigns/%2F/automations"), null);
  assert.equal(AUTOMATION_REGISTRY.length, 1);

  const migration = readFileSync(new URL("../migrations/0009_automations.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE automation_rules/u);
  assert.match(migration, /complete-parent-street-when-all-houses-complete/u);
  assert.match(migration, /PRIMARY KEY \(campaign_id, rule_type\)/u);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/iu);
});

test("only an Admin can read and toggle the fixed Campaign automation", async () => {
  const db = await database();
  const unauthenticated = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations"),
    db,
  );
  assert.equal(unauthenticated?.status, 401);

  const admin = await persistentAccess(db, "admin");
  const initial = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations", { cookie: admin }),
    db,
  );
  assert.equal(initial?.status, 200);
  assert.equal((await payload(initial!)).automations[0].enabled, false);

  const enabled = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      body: { enabled: true },
    }),
    db,
  );
  assert.equal(enabled?.status, 200);
  assert.equal((await payload(enabled!)).automation.enabled, true);

  const replay = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      body: { enabled: true },
    }),
    db,
  );
  assert.equal(replay?.status, 200);
  assert.equal((await payload(replay!)).automation.enabled, true);

  const disabled = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      body: { enabled: false },
    }),
    db,
  );
  assert.equal(disabled?.status, 200);
  assert.equal((await payload(disabled!)).automation.enabled, false);
});

test("Viewer, Team Editor and temporary members cannot manage automations", async () => {
  const db = await database();
  const viewer = await persistentAccess(db, "viewer");
  const editor = await persistentAccess(db, "team-editor", "campaign_automation", "team_automation");
  const temporary = await temporaryAccess(db);

  for (const cookie of [viewer, editor, temporary]) {
    const response = await handleAutomationsApi(
      request("/api/campaigns/campaign_automation/automations", { cookie }),
      db,
    );
    assert.equal(response?.status, 403);
  }

  const response = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: editor,
      body: { enabled: true },
    }),
    db,
  );
  assert.equal(response?.status, 403);
});

test("unknown rules, invalid bodies, cross-origin writes and cross-Campaign selectors fail closed", async () => {
  const db = await database();
  const admin = await persistentAccess(db, "admin");

  const unknown = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/unknown-rule", { cookie: admin }),
    db,
  );
  assert.equal(unknown?.status, 404);

  const invalid = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      body: { enabled: "yes" },
    }),
    db,
  );
  assert.equal(invalid?.status, 400);

  const extra = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      body: { enabled: true, ruleType: "other" },
    }),
    db,
  );
  assert.equal(extra?.status, 400);

  const crossOrigin = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation/automations/complete-parent-street-when-all-houses-complete", {
      method: "PATCH",
      cookie: admin,
      origin: "https://evil.example",
      body: { enabled: true },
    }),
    db,
  );
  assert.equal(crossOrigin?.status, 403);

  const crossCampaign = await handleAutomationsApi(
    request("/api/campaigns/campaign_automation_other/automations", { cookie: admin }),
    db,
  );
  assert.equal(crossCampaign?.status, 401);
});

test("missing migration returns an explicit 503 after access resolution", async () => {
  const db = await database(false);
  const admin = await persistentAccess(db, "admin");
  const response = await productionWorker.fetch(
    request("/api/campaigns/campaign_automation/automations", { cookie: admin }),
    { DB: db },
  );
  assert.equal(response.status, 503);
  assert.equal((await payload(response)).error.code, "automation_schema_unavailable");
});
