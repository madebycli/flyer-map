import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AccessContext } from "../worker/access.ts";
import {
  areaPreparationFingerprint,
  getAreaTaskPreparationState,
  prepareAreaTasks,
} from "../worker/areaTaskPreparation.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { handleRxdbPull } from "../worker/rxdbSync.ts";

class SqliteStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly sqlite: DatabaseSync,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.sqlite.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    return this.sqlite.prepare(this.query).run(...this.values);
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");
  taskInserts = 0;
  taskDeletes = 0;
  failOnQueryPart: string | null = null;

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
      "0017_rxdb_sync_changes.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
  }

  prepare(query: string) {
    return new SqliteStatement(query, this.sqlite);
  }

  resetStreetWriteCounts() {
    this.taskInserts = 0;
    this.taskDeletes = 0;
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as SqliteStatement[]).map<D1RunResult>((statement) => {
        if (this.failOnQueryPart && statement.query.includes(this.failOnQueryPart)) {
          throw new Error("forced_batch_failure");
        }
        const result = statement.run();
        const changes = Number(result.changes);
        const normalized = statement.query.trimStart();
        if (normalized.startsWith("INSERT INTO tasks")) this.taskInserts += changes;
        if (normalized.startsWith("DELETE FROM tasks")) this.taskDeletes += changes;
        return { success: true, meta: { changes } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const campaignId = "campaign_reconcile-runtime";
const areaId = "area_reconcile-runtime";
const teamId = "team_reconcile-runtime";
const time = "2026-09-02T18:00:00.000Z";
const admin: AccessContext = {
  grantId: "admin",
  campaignId,
  role: "admin",
  teamId: null,
  label: null,
};

function seed(db: SqliteD1) {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [[
      [13.7, 51.0],
      [13.71, 51.0],
      [13.71, 51.01],
      [13.7, 51.01],
      [13.7, 51.0],
    ]],
  };
  db.sqlite.prepare(
    "INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, ?, 'active', 3, 'seed-token', ?, ?)",
  ).run(campaignId, "Runtime", time, time);
  db.sqlite.prepare(
    "INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES (?, ?, ?, '#2563eb', ?, ?)",
  ).run(teamId, campaignId, "Team", time, time);
  db.sqlite.prepare(
    "INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(areaId, campaignId, teamId, "Area", JSON.stringify(geometry), time, time);
  db.sqlite.prepare(
    "INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'street', ?, ?, 'later', NULL, ?, ?)",
  ).run("task_manual", campaignId, areaId, "Manual", JSON.stringify({
    type: "LineString", coordinates: [[13.701, 51.001], [13.702, 51.001]],
  }), time, time);
  return geometry;
}

function osmResponse(includeRoad = true) {
  return new Response(JSON.stringify({
    osm3s: { timestamp_osm_base: time },
    elements: includeRoad ? [{
      type: "way",
      id: 100,
      tags: { highway: "residential", name: "Gebietsstraße" },
      geometry: [
        { lon: 13.699, lat: 51.005 },
        { lon: 13.711, lat: 51.005 },
      ],
    }] : [],
  }));
}

function options(input: { includeRoad?: boolean; fetchImpl?: () => Promise<Response> } = {}) {
  let counter = 0;
  return {
    upstreamUrl: "http://localhost/overpass",
    now: () => new Date(time),
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    fetchImpl: input.fetchImpl ?? (async () => osmResponse(input.includeRoad ?? true)),
  };
}

function maxSeq(db: SqliteD1) {
  return Number(db.sqlite.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?",
  ).get(campaignId)?.seq ?? 0);
}

function forceRecompute(db: SqliteD1) {
  db.sqlite.prepare(
    "UPDATE area_task_preparations SET geometry_hash = 'forced-old-fingerprint' WHERE campaign_id = ? AND area_id = ?",
  ).run(campaignId, areaId);
}

test("forced same-result recompute keeps stable Street ID with zero D1 Street insert/delete and zero Street feed churn", async () => {
  const db = new SqliteD1();
  const geometry = seed(db);
  const first = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.equal(first.outcome, "ready");
  const firstId = String(db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId)?.id);
  assert.match(firstId, /^task_auto_[0-9a-f]{64}$/u);
  const firstSeq = maxSeq(db);
  const currentFingerprint = await areaPreparationFingerprint(geometry);
  assert.equal((await getAreaTaskPreparationState(db, campaignId, areaId))?.geometryHash, currentFingerprint);

  forceRecompute(db);
  db.resetStreetWriteCounts();
  const second = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.equal(second.outcome, "ready");
  const secondId = String(db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId)?.id);
  assert.equal(secondId, firstId);
  assert.equal(db.taskInserts, 0);
  assert.equal(db.taskDeletes, 0);
  assert.equal(db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ? AND collection_name = 'streetTasks' AND seq > ?",
  ).get(campaignId, firstSeq)?.count, 0);
  const manual = db.sqlite.prepare(
    "SELECT label, status, area_preparation_generation FROM tasks WHERE id = 'task_manual'",
  ).get() as { label: string; status: string; area_preparation_generation: string | null };
  assert.deepEqual(manual, { label: "Manual", status: "later", area_preparation_generation: null });
});

test("ready same fingerprint is no-op while an older algorithm fingerprint requires a new run", async () => {
  const db = new SqliteD1();
  const geometry = seed(db);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options())).outcome, "ready");
  assert.deepEqual(await prepareAreaTasks(db, campaignId, areaId, options()), { outcome: "no-op", state: "ready" });
  const oldFingerprint = await areaPreparationFingerprint(geometry, "street-v0");
  db.sqlite.prepare(
    "UPDATE area_task_preparations SET geometry_hash = ? WHERE campaign_id = ? AND area_id = ?",
  ).run(oldFingerprint, campaignId, areaId);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options())).outcome, "ready");
});

test("obsolete worked auto Street blocks reprepare without revision, deletion, status reset or feed", async () => {
  const db = new SqliteD1();
  seed(db);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options())).outcome, "ready");
  const automatic = db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as { id: string };
  db.sqlite.prepare("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(time, automatic.id);
  forceRecompute(db);
  const revision = db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision;
  const seq = maxSeq(db);
  const result = await prepareAreaTasks(db, campaignId, areaId, options({ includeRoad: false }));
  assert.deepEqual(result, { outcome: "failed", code: "area_preparation_work_started" });
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, revision);
  assert.equal(maxSeq(db), seq);
  assert.deepEqual(
    db.sqlite.prepare("SELECT status, completed_at FROM tasks WHERE id = ?").get(automatic.id),
    { status: "completed", completed_at: time },
  );
});

test("status becoming worked during OSM fetch is caught by the atomic publish guard", async () => {
  const db = new SqliteD1();
  seed(db);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options())).outcome, "ready");
  const automatic = db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as { id: string };
  forceRecompute(db);
  const revision = Number(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision);
  const seq = maxSeq(db);
  let release: (() => void) | null = null;
  let startedResolve: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const response = new Promise<Response>((resolve) => { release = () => resolve(osmResponse(false)); });
  const running = prepareAreaTasks(db, campaignId, areaId, options({
    fetchImpl: async () => {
      startedResolve?.();
      return response;
    },
  }));
  await started;
  db.sqlite.prepare("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(time, automatic.id);
  release?.();
  assert.deepEqual(await running, { outcome: "failed", code: "area_preparation_work_started" });
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, revision);
  assert.equal(maxSeq(db), seq);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?").get(automatic.id)?.count, 1);
});

test("failure while inserting change feed rolls back canonical Street publish and feed together", async () => {
  const db = new SqliteD1();
  seed(db);
  db.failOnQueryPart = "INSERT INTO campaign_sync_changes";
  const result = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.equal(result.outcome, "failed");
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 3);
  assert.equal(db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId)?.count, 0);
  assert.equal(maxSeq(db), 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'task_manual'").get()?.count, 1);
});

test("obsolete open auto Street publishes D1 delete plus feed tombstone consumable by RxDB pull", async () => {
  const db = new SqliteD1();
  seed(db);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options())).outcome, "ready");
  const automaticId = String(db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId)?.id);
  const checkpoint = maxSeq(db);
  forceRecompute(db);
  assert.equal((await prepareAreaTasks(db, campaignId, areaId, options({ includeRoad: false }))).outcome, "ready");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?").get(automaticId)?.count, 0);

  const response = await handleRxdbPull(db, campaignId, "streetTasks", admin, {
    checkpoint: { seq: checkpoint },
    batchSize: 100,
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    documents: Array<{ id: string; _deleted?: boolean }>;
    checkpoint: { seq: number };
  };
  const tombstone = body.documents.find((document) => document.id === automaticId);
  assert.equal(tombstone?._deleted, true);
  assert.ok(body.checkpoint.seq > checkpoint);
});
