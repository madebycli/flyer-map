import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  areaHasStartedAutomaticWork,
  getAreaTaskPreparationState,
  prepareAreaTasks,
} from "../worker/areaTaskPreparation.ts";
import { handleAreaTaskPreparationApi } from "../worker/areaTaskPreparationApi.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import type { AccessContext } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

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

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
  }

  prepare(query: string) {
    return new SqliteStatement(query, this.sqlite);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as SqliteStatement[]).map<D1RunResult>((statement) => {
        const result = statement.run();
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const campaignId = "campaign_auto-runtime";
const areaId = "area_auto-runtime";
const teamId = "team_auto-runtime";
const time = "2026-08-31T15:00:00.000Z";

function seed(db: SqliteD1) {
  const geometry = {
    type: "Polygon",
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
    "INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'street', ?, ?, 'open', NULL, ?, ?)",
  ).run("task_manual", campaignId, areaId, "Manuell", JSON.stringify({
    type: "LineString", coordinates: [[13.701, 51.001], [13.702, 51.001]],
  }), time, time);
  return geometry;
}

function osmResponse() {
  return new Response(JSON.stringify({
    osm3s: { timestamp_osm_base: time },
    elements: [
      {
        type: "way",
        id: 100,
        tags: { highway: "residential", name: "Gebietsstraße" },
        geometry: [
          { lon: 13.699, lat: 51.005 },
          { lon: 13.711, lat: 51.005 },
        ],
      },
      {
        type: "way",
        id: 200,
        tags: { building: "house", "addr:street": "Gebietsstraße", "addr:housenumber": "7" },
        geometry: [
          { lon: 13.703, lat: 51.003 },
          { lon: 13.704, lat: 51.003 },
          { lon: 13.704, lat: 51.004 },
          { lon: 13.703, lat: 51.003 },
        ],
      },
      {
        type: "way",
        id: 201,
        tags: { building: "house" },
        geometry: [
          { lon: 13.709, lat: 51.009 },
          { lon: 13.712, lat: 51.009 },
          { lon: 13.712, lat: 51.012 },
          { lon: 13.709, lat: 51.009 },
        ],
      },
    ],
  }));
}

function options(counter = { value: 0 }) {
  return {
    upstreamUrl: "http://localhost/overpass",
    now: () => new Date(time),
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter.value).padStart(12, "0")}`,
    fetchImpl: async () => osmResponse(),
  };
}

test("prepared Area publishes real tasks atomically, keeps manual work, and bumps revision once", async () => {
  const db = new SqliteD1();
  seed(db);

  const result = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.equal(result.outcome, "ready");
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 4);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE campaign_id = ?").get(campaignId)?.count, 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM house_tasks WHERE campaign_id = ?").get(campaignId)?.count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'task_manual'").get()?.count, 1);
  const automatic = db.sqlite.prepare(
    "SELECT source_json, area_preparation_generation, status FROM tasks WHERE id <> 'task_manual'",
  ).get() as { source_json: string; area_preparation_generation: string; status: string };
  assert.equal(automatic.status, "open");
  assert.match(automatic.area_preparation_generation, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(JSON.parse(automatic.source_json), {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [100],
  });
  const snapshot = await loadCampaignSnapshot(db, campaignId);
  assert.equal(snapshot?.tasks.find((task) => task.id === "task_manual")?.areaPreparationGeneration, null);
  assert.match(
    snapshot?.tasks.find((task) => task.id !== "task_manual")?.areaPreparationGeneration ?? "",
    /^[0-9a-f-]{36}$/u,
  );
  const state = await getAreaTaskPreparationState(db, campaignId, areaId);
  assert.deepEqual(
    { status: state?.status, roadCount: state?.roadCount, houseCount: state?.houseCount, sourceTimestamp: state?.sourceTimestamp },
    { status: "ready", roadCount: 1, houseCount: 1, sourceTimestamp: time },
  );

  const repeated = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.deepEqual(repeated, { outcome: "no-op", state: "ready" });
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 4);
});

test("feature-cap failure records failed state and publishes no partial automatic rows", async () => {
  const db = new SqliteD1();
  seed(db);
  const result = await prepareAreaTasks(db, campaignId, areaId, {
    ...options(),
    maxRoadFragments: 0,
  });
  assert.deepEqual(result, { outcome: "failed", code: "area_preparation_too_many_features" });
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE campaign_id = ?").get(campaignId)?.count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM house_tasks WHERE campaign_id = ?").get(campaignId)?.count, 0);
  const state = await getAreaTaskPreparationState(db, campaignId, areaId);
  assert.equal(state?.status, "failed");
  assert.equal(state?.lastErrorCode, "area_preparation_too_many_features");

  const retry = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.equal(retry.outcome, "ready");
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 4);
});

test("fresh pending preparation deduplicates before a second upstream request", async () => {
  const db = new SqliteD1();
  seed(db);
  let fetchCount = 0;
  let release: (() => void) | null = null;
  let startedResolve: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const response = new Promise<Response>((resolve) => { release = () => resolve(osmResponse()); });
  const first = prepareAreaTasks(db, campaignId, areaId, {
    ...options(),
    fetchImpl: async () => {
      fetchCount += 1;
      startedResolve?.();
      return response;
    },
  });
  await started;
  const second = await prepareAreaTasks(db, campaignId, areaId, options());
  assert.deepEqual(second, { outcome: "no-op", state: "pending" });
  assert.equal(fetchCount, 1);
  release?.();
  assert.equal((await first).outcome, "ready");
});

test("geometry changed during OSM fetch makes the old generation stale without a publish", async () => {
  const db = new SqliteD1();
  seed(db);
  let release: (() => void) | null = null;
  let fetchStartedResolve: (() => void) | null = null;
  const fetchStarted = new Promise<void>((resolve) => { fetchStartedResolve = resolve; });
  const waitForResponse = new Promise<Response>((resolve) => { release = () => resolve(osmResponse()); });
  let firstFetch = true;
  const running = prepareAreaTasks(db, campaignId, areaId, {
    ...options(),
    fetchImpl: async () => {
      if (firstFetch) {
        firstFetch = false;
        fetchStartedResolve?.();
        return waitForResponse;
      }
      return osmResponse();
    },
  });
  await fetchStarted;
  db.sqlite.prepare("UPDATE areas SET geometry_json = ? WHERE id = ? AND campaign_id = ?").run(JSON.stringify({
    type: "Polygon",
    coordinates: [[[13.7, 51.0], [13.705, 51.0], [13.705, 51.005], [13.7, 51.0]]],
  }), areaId, campaignId);
  release?.();
  const result = await running;
  assert.deepEqual(result, { outcome: "stale", code: "area_preparation_stale" });
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE campaign_id = ?").get(campaignId)?.count, 1);
});

test("recovery API scopes reads and queues only authorized server-side preparation", async () => {
  const db = new SqliteD1();
  seed(db);
  const route = { campaignId, areaId };
  const admin: AccessContext = { grantId: "admin", campaignId, role: "admin", teamId: null, label: null };
  const editor: AccessContext = { grantId: "editor", campaignId, role: "team-editor", teamId, label: null };
  const wrongEditor: AccessContext = { grantId: "wrong", campaignId, role: "team-editor", teamId: "team_other", label: null };
  const viewer: AccessContext = { grantId: "viewer", campaignId, role: "viewer", teamId: null, label: null };
  const fieldGroup: AccessContext = { grantId: "field", campaignId, role: "field-group-member", teamId, label: null };
  const queued: Promise<unknown>[] = [];
  const context = { waitUntil: (job: Promise<unknown>) => queued.push(job) };
  let releasePending: (() => void) | null = null;
  const pendingResponse = new Promise<Response>((resolve) => {
    releasePending = () => resolve(osmResponse());
  });
  let pendingFetchCount = 0;
  const pendingOptions = {
    ...options(),
    fetchImpl: async () => {
      pendingFetchCount += 1;
      return pendingFetchCount === 1 ? pendingResponse : osmResponse();
    },
  };

  const get = await handleAreaTaskPreparationApi(
    new Request("https://example.test/api/campaigns/x/areas/x/preparation"), db, route, viewer, context,
  );
  assert.deepEqual(await get.json(), {
    status: "missing", roadCount: 0, houseCount: 0, sourceTimestamp: null, errorCode: null, updatedAt: null,
  });
  assert.equal((await handleAreaTaskPreparationApi(new Request("https://example.test", { method: "POST" }), db, route, wrongEditor, context)).status, 403);
  assert.equal((await handleAreaTaskPreparationApi(new Request("https://example.test", { method: "POST" }), db, route, viewer, context)).status, 403);
  assert.equal((await handleAreaTaskPreparationApi(new Request("https://example.test", { method: "POST" }), db, route, fieldGroup, context)).status, 403);
  assert.equal((await handleAreaTaskPreparationApi(new Request("https://example.test", { method: "POST" }), db, route, { ...admin, campaignId: "campaign_other" }, context)).status, 403);
  assert.equal((await handleAreaTaskPreparationApi(
    new Request("https://example.test", { method: "POST", body: JSON.stringify({ bbox: [1, 2, 3, 4] }) }),
    db,
    route,
    editor,
    context,
  )).status, 400);
  assert.equal(queued.length, 0);

  const accepted = await handleAreaTaskPreparationApi(
    new Request("https://example.test", { method: "POST" }), db, route, editor, context, pendingOptions,
  );
  assert.equal(accepted.status, 202);
  assert.equal(queued.length, 1);
  const duplicatePending = await handleAreaTaskPreparationApi(
    new Request("https://example.test", { method: "POST" }), db, route, admin, context, options(),
  );
  assert.equal(duplicatePending.status, 202);
  assert.equal(queued.length, 1);
  releasePending?.();
  await Promise.all(queued);
  const ready = await handleAreaTaskPreparationApi(
    new Request("https://example.test", { method: "POST" }), db, route, admin, context,
  );
  assert.equal(ready.status, 200);
  assert.equal(queued.length, 1);
});

test("only successful non-replayed Area create and geometry mutations schedule preparation", async () => {
  const db = new SqliteD1();
  seed(db);
  const access: AccessContext = { grantId: "admin", campaignId, role: "admin", teamId: null, label: null };
  const queued: Promise<unknown>[] = [];
  const context = { waitUntil: (job: Promise<unknown>) => queued.push(job) };
  const createdGeometry = {
    type: "Polygon" as const,
    coordinates: [[
      [13.72, 51.0], [13.73, 51.0], [13.73, 51.01], [13.72, 51.01], [13.72, 51.0],
    ]],
  };
  const create = {
    id: "mutation_area-create-auto",
    campaignId,
    baseRevision: 3,
    createdAt: "2026-08-31T15:02:00.000Z",
    type: "area.create" as const,
    payload: { areaId: "area_created", teamId, name: "Neu", geometry: createdGeometry },
  };
  const request = (mutation: unknown) => new Request("https://example.test/api/campaigns/x/mutations", {
    method: "POST",
    body: JSON.stringify({ mutation }),
  });
  const created = await handleCampaignMutation(request(create), db, campaignId, access, context, options());
  assert.equal(created.status, 200);
  assert.equal(queued.length, 1);
  await Promise.all(queued);
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 5);

  const replay = await handleCampaignMutation(request(create), db, campaignId, access, context, options());
  assert.equal(replay.status, 200);
  assert.equal(queued.length, 1);

  const update = {
    id: "mutation_area-update-auto",
    campaignId,
    baseRevision: 5,
    createdAt: "2026-08-31T15:03:00.000Z",
    type: "area.update-geometry" as const,
    payload: {
      areaId: "area_created",
      expectedUpdatedAt: create.createdAt,
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [13.72, 51.0], [13.728, 51.0], [13.728, 51.008], [13.72, 51.008], [13.72, 51.0],
        ]],
      },
    },
  };
  const updated = await handleCampaignMutation(request(update), db, campaignId, access, context, options());
  assert.equal(updated.status, 200);
  assert.equal(queued.length, 2);
  await Promise.all(queued);
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 7);

  const alternateTeamId = "team_auto-alternate";
  db.sqlite.prepare(
    "INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES (?, ?, ?, '#be123c', ?, ?)",
  ).run(alternateTeamId, campaignId, "Anderes Team", time, time);
  const rename = {
    id: "mutation_area-rename-no-auto",
    campaignId,
    baseRevision: 7,
    createdAt: "2026-08-31T15:04:00.000Z",
    type: "area.rename" as const,
    payload: { areaId: "area_created", name: "Umbenannt", expectedUpdatedAt: update.createdAt },
  };
  assert.equal((await handleCampaignMutation(request(rename), db, campaignId, access, context, options())).status, 200);
  assert.equal(queued.length, 2);
  const setTeam = {
    id: "mutation_area-team-no-auto",
    campaignId,
    baseRevision: 8,
    createdAt: "2026-08-31T15:05:00.000Z",
    type: "area.set-team" as const,
    payload: {
      areaId: "area_created",
      teamId: alternateTeamId,
      expectedUpdatedAt: rename.createdAt,
    },
  };
  assert.equal((await handleCampaignMutation(request(setTeam), db, campaignId, access, context, options())).status, 200);
  assert.equal(queued.length, 2);

  const conflict = await handleCampaignMutation(request({
    ...update,
    id: "mutation_area-conflict-auto",
    baseRevision: 9,
    payload: { ...update.payload, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
  }), db, campaignId, access, context, options());
  assert.equal(conflict.status, 409);
  assert.equal(queued.length, 2);
});

test("non-open automatic tasks block Area geometry edits while open work can be re-prepared", async () => {
  const db = new SqliteD1();
  seed(db);
  await prepareAreaTasks(db, campaignId, areaId, options());
  for (const status of ["completed", "later", "not-deliverable"]) {
    db.sqlite.prepare("UPDATE tasks SET status = ?, completed_at = ? WHERE id <> 'task_manual'").run(
      status,
      status === "completed" ? time : null,
    );
    assert.equal(await areaHasStartedAutomaticWork(db, campaignId, areaId), true);
  }

  const access: AccessContext = { grantId: "admin", campaignId, role: "admin", teamId: null, label: null };
  const queued: Promise<unknown>[] = [];
  const response = await handleCampaignMutation(new Request("https://example.test/api/campaigns/x/mutations", {
    method: "POST",
    body: JSON.stringify({ mutation: {
      id: "mutation_started-work",
      campaignId,
      baseRevision: 4,
      createdAt: "2026-08-31T15:04:00.000Z",
      type: "area.update-geometry",
      payload: {
        areaId,
        expectedUpdatedAt: time,
        geometry: {
          type: "Polygon",
          coordinates: [[[13.7, 51.0], [13.708, 51.0], [13.708, 51.008], [13.7, 51.0]]],
        },
      },
    } }),
  }), db, campaignId, access, { waitUntil: (job) => queued.push(job) }, options());
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "area_has_started_work");
  assert.equal(queued.length, 0);
});

test("real mutation endpoint returns the exact automatic-task delete conflict", async () => {
  const db = new SqliteD1();
  seed(db);
  await prepareAreaTasks(db, campaignId, areaId, options());
  const automatic = db.sqlite.prepare(
    "SELECT id, updated_at FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as { id: string; updated_at: string };
  const access: AccessContext = { grantId: "admin", campaignId, role: "admin", teamId: null, label: null };
  const response = await handleCampaignMutation(new Request("https://example.test/api/campaigns/x/mutations", {
    method: "POST",
    body: JSON.stringify({ mutation: {
      id: "mutation_delete-auto-runtime",
      campaignId,
      baseRevision: 4,
      createdAt: "2026-08-31T15:05:00.000Z",
      type: "task.delete",
      payload: { taskId: automatic.id, expectedUpdatedAt: automatic.updated_at },
    } }),
  }), db, campaignId, access);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "auto_prepared_task_delete_forbidden");
});


test("reprepare updates generation without changing stable identity", async () => {
  const db = new SqliteD1();
  seed(db);
  const generationCounter = { value: 0 };
  await prepareAreaTasks(db, campaignId, areaId, options(generationCounter));

  const automatic = db.sqlite.prepare(
    "SELECT id, area_preparation_generation, created_at FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as { id: string; area_preparation_generation: string; created_at: string };
  db.sqlite.prepare(
    "UPDATE tasks SET label = ? WHERE id = ?",
  ).run("Vom Team geprüft", automatic.id);
  db.sqlite.prepare(
    "UPDATE area_task_preparations SET status = 'failed', geometry_hash = ?, last_error_code = ? WHERE campaign_id = ? AND area_id = ?",
  ).run("old-fingerprint", "area_preparation_osm_failed", campaignId, areaId);

  const reprepareTime = "2026-08-31T15:01:00.000Z";
  const result = await prepareAreaTasks(db, campaignId, areaId, {
    ...options(generationCounter),
    now: () => new Date(reprepareTime),
  });
  assert.equal(result.outcome, "ready");
  const after = db.sqlite.prepare(
    "SELECT id, label, status, area_preparation_generation, created_at, updated_at FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as {
    id: string;
    label: string;
    status: string;
    area_preparation_generation: string;
    created_at: string;
    updated_at: string;
  };
  assert.equal(after.id, automatic.id);
  assert.equal(after.label, "Vom Team geprüft");
  assert.equal(after.status, "open");
  assert.equal(after.created_at, automatic.created_at);
  assert.notEqual(after.area_preparation_generation, automatic.area_preparation_generation);
  assert.equal(after.updated_at, reprepareTime);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = 'task_manual'").get()?.count, 1);
});

test("worked automatic Streets expose action-required semantics without a retry loop", async () => {
  const db = new SqliteD1();
  seed(db);
  await prepareAreaTasks(db, campaignId, areaId, options());
  const automatic = db.sqlite.prepare(
    "SELECT id FROM tasks WHERE campaign_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId) as { id: string };
  db.sqlite.prepare("UPDATE tasks SET status = 'later' WHERE id = ?").run(automatic.id);
  db.sqlite.prepare(
    "UPDATE area_task_preparations SET status = 'failed', geometry_hash = ?, last_error_code = ? WHERE campaign_id = ? AND area_id = ?",
  ).run("old-fingerprint", "area_preparation_osm_failed", campaignId, areaId);

  let fetchCount = 0;
  const result = await prepareAreaTasks(db, campaignId, areaId, {
    ...options(),
    fetchImpl: async () => {
      fetchCount += 1;
      return osmResponse();
    },
  });
  assert.deepEqual(result, { outcome: "failed", code: "area_preparation_work_started" });
  assert.equal(fetchCount, 0);
});
