import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import { handleRxdbCheckpoint, handleRxdbPull, handleRxdbPush } from "../worker/rxdbSync.ts";
import { MissionRxdbSync, TrailingPersistenceGate } from "../src/data/rxdbMissionSync.ts";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(readonly query: string, private readonly sqlite: DatabaseSync) {}

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
    for (const file of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
      "0017_rxdb_sync_changes.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  prepare(query: string) {
    return new Statement(query, this.sqlite);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as Statement[]).map<D1RunResult>((statement) => {
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

class SchemaUnavailableStatement implements D1PreparedStatement {
  bind() {
    return this;
  }

  async first<T>() {
    return null as T | null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

/** Simulates a retryable migration/schema outage without changing canonical D1. */
class SchemaUnavailableD1 implements D1DatabaseLike {
  constructor(private readonly delegate: SqliteD1) {}

  prepare(query: string) {
    return query.includes("PRAGMA table_info(campaign_sync_changes)")
      ? new SchemaUnavailableStatement()
      : this.delegate.prepare(query);
  }

  batch(statements: D1PreparedStatement[]) {
    return this.delegate.batch(statements);
  }
}

function installFakeWindowClock() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousSetTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
  const previousClearTimeout = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const fakeWindow = {
    setTimeout(callback: () => void, delayMs: number) {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true, value: fakeWindow.setTimeout.bind(fakeWindow) });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, writable: true, value: fakeWindow.clearTimeout.bind(fakeWindow) });
  return {
    advance(milliseconds: number) {
      now += milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort(([, left], [, right]) => left.at - right.at);
        if (due.length === 0) return;
        for (const [id, timer] of due) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    restore() {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (previousSetTimeout) Object.defineProperty(globalThis, "setTimeout", previousSetTimeout);
      else Reflect.deleteProperty(globalThis, "setTimeout");
      if (previousClearTimeout) Object.defineProperty(globalThis, "clearTimeout", previousClearTimeout);
      else Reflect.deleteProperty(globalThis, "clearTimeout");
    },
  };
}

async function settledMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

async function countTrailingWrites(values: readonly string[]) {
  const clock = installFakeWindowClock();
  try {
    const gate = new TrailingPersistenceGate();
    let latest = "";
    let persisted = "";
    let writes = 0;
    let flushQueued = false;
    for (const value of values) {
      latest = value;
      void gate.wait().then(() => {
        if (flushQueued) return;
        flushQueued = true;
        queueMicrotask(() => {
          flushQueued = false;
          writes += 1;
          persisted = latest;
        });
      });
    }
    clock.advance(899);
    await settledMicrotasks();
    assert.equal(writes, 0, "the trailing window must not flush early");
    clock.advance(1);
    await settledMicrotasks();
    assert.equal(writes, 1, "one burst must become one upstream write");
    assert.equal(persisted, values.at(-1));
    return writes;
  } finally {
    clock.restore();
  }
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

async function countActualReplicationWrites(
  collectionName: "campaigns" | "teams",
  values: readonly string[],
  makeMutation: (value: string, index: number, campaignId: string) => unknown,
) {
  const campaignId = `wc-${collectionName}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const team = { id: "team_a", campaignId, name: "Team", color: "#2563eb", createdAt: timestamp, updatedAt: timestamp };
  const campaign = { id: campaignId, campaignId, name: "Campaign", status: "active", defaultMapView: null, createdAt: timestamp, updatedAt: timestamp };
  const bootstrap: Record<string, unknown[]> = {
    campaigns: [campaign],
    teams: [team],
    areas: [],
    streetTasks: [],
    houseTasks: [],
  };
  const pushes: Array<{ collectionName: string; body: unknown }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
  const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const hostSetInterval = globalThis.setInterval.bind(globalThis);
  const hostClearInterval = globalThis.clearInterval.bind(globalThis);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { setTimeout: hostSetTimeout, clearTimeout: hostClearTimeout, setInterval: hostSetInterval, clearInterval: hostClearInterval },
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://flyer.test");
    const parts = url.pathname.split("/");
    const operation = parts.at(-2);
    const collection = parts.at(-1) ?? "";
    if (operation === "pull") {
      return Response.json({ documents: bootstrap[collection] ?? [], checkpoint: { seq: 0 }, campaignRevision: 3 });
    }
    if (operation === "push") {
      pushes.push({ collectionName: collection, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
      return Response.json({ conflicts: [], rejections: [] });
    }
    return new Response(null, { status: 404 });
  };
  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  try {
    await sync.start();
    const collections = (sync as unknown as { collections: Record<string, any> }).collections;
    await waitForCondition(async () => Boolean(await collections.campaigns.findOne(campaignId).exec()));
    await waitForCondition(async () => Boolean(await collections.teams.findOne("team_a").exec()));
    pushes.length = 0;
    for (const [index, value] of values.entries()) {
      await sync.applyMutation(makeMutation(value, index, campaignId) as any);
    }
    await waitForCondition(async () => pushes.some((push) => push.collectionName === collectionName));
    await new Promise((resolve) => hostSetTimeout(resolve, 1_100));
    return pushes.filter((push) => push.collectionName === collectionName).length;
  } finally {
    await sync.destroy();
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

const campaignId = "campaign_rxdb-runtime";
const timestamp = "2026-09-02T10:00:00.000Z";

function seed(db: SqliteD1, targetCampaignId = campaignId) {
  db.sqlite.prepare("INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, 'Mission', 'active', 3, 'seed', ?, ?)").run(targetCampaignId, timestamp, timestamp);
  for (const [teamId, areaId, taskId, color] of [["team_a", "area_a", "task_a", "#2563eb"], ["team_b", "area_b", "task_b", "#ea580c"]] as const) {
    db.sqlite.prepare("INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(teamId, targetCampaignId, teamId, color, timestamp, timestamp);
    db.sqlite.prepare("INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(areaId, targetCampaignId, teamId, areaId, JSON.stringify({ type: "Polygon", coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] }), timestamp, timestamp);
    db.sqlite.prepare("INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'street', ?, ?, 'open', NULL, ?, ?)").run(taskId, targetCampaignId, areaId, taskId, JSON.stringify({ type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] }), timestamp, timestamp);
  }
}

const fieldAccess: AccessContext = { grantId: "grant_field", campaignId, role: "field-group-member", teamId: "team_a", label: "A", groupId: "group_a", membershipId: "membership_a" };
const viewerAccess: AccessContext = { grantId: "grant_view", campaignId, role: "viewer", teamId: null, label: "Viewer" };
const adminAccess: AccessContext = { grantId: "grant_admin", campaignId, role: "admin", teamId: null, label: "Admin" };

test("RxDB bootstrap and incremental pull stay collection-scoped for a Field Group", async () => {
  const db = new SqliteD1();
  seed(db);
  const bootstrap = await handleRxdbPull(db, campaignId, "streetTasks", fieldAccess, { checkpoint: null, batchSize: 100 });
  assert.equal(bootstrap.status, 200);
  const bootstrapBody = await bootstrap.json() as { documents: Array<{ id: string }>; checkpoint: { seq: number }; campaignRevision: number };
  assert.deepEqual(bootstrapBody.documents.map((document) => document.id), ["task_a"]);
  assert.equal(bootstrapBody.campaignRevision, 3);

  const mutation = await handleCampaignMutation(new Request("https://flyer.test/mutations", {
    method: "POST",
    body: JSON.stringify({ mutation: { id: "mutation_rxdb_status", campaignId, baseRevision: 3, createdAt: "2026-09-02T10:01:00.000Z", type: "task.set-status", payload: { taskId: "task_a", status: "completed", completedAt: "2026-09-02T10:01:00.000Z", expectedUpdatedAt: timestamp } }, fieldGroupId: "group_a" }),
  }), db, campaignId, fieldAccess);
  assert.equal(mutation.status, 200, await mutation.text());

  const incremental = await handleRxdbPull(db, campaignId, "streetTasks", fieldAccess, { checkpoint: { seq: 0 }, batchSize: 100 });
  const incrementalBody = await incremental.json() as { documents: Array<{ id: string; status: string }>; checkpoint: { seq: number }; campaignRevision: number };
  assert.deepEqual(incrementalBody.documents.map((document) => ({ id: document.id, status: document.status })), [{ id: "task_a", status: "completed" }]);
  assert.ok(incrementalBody.checkpoint.seq > 0);
  assert.equal(incrementalBody.campaignRevision, 4);

  const rename = await handleCampaignMutation(new Request("https://flyer.test/mutations", {
    method: "POST",
    body: JSON.stringify({ mutation: { id: "mutation_rxdb_campaign", campaignId, baseRevision: 4, createdAt: "2026-09-02T10:02:00.000Z", type: "campaign.rename", payload: { name: "Mission neu", expectedName: "Mission" } } }),
  }), db, campaignId, adminAccess);
  assert.equal(rename.status, 200, await rename.text());

  const campaignIncremental = await handleRxdbPull(db, campaignId, "campaigns", fieldAccess, { checkpoint: { seq: 0 }, batchSize: 100 });
  const campaignBody = await campaignIncremental.json() as { documents: Array<{ id: string; name: string }> };
  assert.deepEqual(campaignBody.documents.map((document) => ({ id: document.id, name: document.name })), [{ id: campaignId, name: "Mission neu" }]);
});

test("RxDB push keeps Worker authorization and viewer guards authoritative", async () => {
  const db = new SqliteD1();
  seed(db);
  const viewer = await handleRxdbPush(db, campaignId, "streetTasks", viewerAccess, { rows: [] });
  assert.equal(viewer.status, 403);

  const foreign = await handleRxdbPush(db, campaignId, "streetTasks", fieldAccess, {
    rows: [{
      assumedMasterState: { id: "task_b", campaignId, areaId: "area_b", taskType: "street", label: "task_b", geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] }, areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp },
      newDocumentState: { id: "task_b", campaignId, areaId: "area_b", taskType: "street", label: "task_b", geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] }, areaPreparationGeneration: null, status: "completed", completedAt: "2026-09-02T10:01:00.000Z", createdAt: timestamp, updatedAt: "2026-09-02T10:01:00.000Z" },
    }],
  });
  assert.equal(foreign.status, 200);
  const body = await foreign.json() as { rejections: Array<{ documentId: string; code: string }>; conflicts: Array<{ id: string; _deleted?: boolean }> };
  assert.deepEqual(body.rejections, [{ documentId: "task_b", code: "write_forbidden" }]);
  assert.deepEqual(body.conflicts.map((document) => ({ id: document.id, _deleted: document._deleted })), [{ id: "task_b", _deleted: true }]);
});

test("a retryable Team push does not block an independent Street pull", async () => {
  const db = new SqliteD1();
  seed(db);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
  const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const hostSetInterval = globalThis.setInterval.bind(globalThis);
  const hostClearInterval = globalThis.clearInterval.bind(globalThis);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { setTimeout: hostSetTimeout, clearTimeout: hostClearTimeout, setInterval: hostSetInterval, clearInterval: hostClearInterval },
  });
  let failedTeamPushStatus: number | null = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://flyer.test");
    const parts = url.pathname.split("/");
    const operation = parts.at(-2);
    const collection = parts.at(-1) as "campaigns" | "teams" | "areas" | "streetTasks" | "houseTasks";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (operation === "pull") return handleRxdbPull(db, campaignId, collection, fieldAccess, body);
    if (operation === "push") {
      const response = await handleRxdbPush(
        collection === "teams" && failedTeamPushStatus === null ? new SchemaUnavailableD1(db) : db,
        campaignId,
        collection,
        fieldAccess,
        body,
      );
      if (collection === "teams" && failedTeamPushStatus === null) failedTeamPushStatus = response.status;
      return response;
    }
    return new Response(null, { status: 404 });
  };
  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  try {
    await sync.start();
    const collections = (sync as unknown as { collections: Record<string, any> }).collections;
    await waitForCondition(async () => Boolean(await collections.campaigns.findOne(campaignId).exec()));
    await waitForCondition(async () => Boolean(await collections.teams.findOne("team_a").exec()));

    // Client A reaches the real Worker push handler and gets a retryable 503.
    await sync.applyMutation({
      id: "mutation_rxdb_failed_team_push",
      campaignId,
      baseRevision: 3,
      createdAt: "2026-09-02T10:03:00.000Z",
      type: "team.update",
      payload: { teamId: "team_a", color: "#16a34a", expectedUpdatedAt: timestamp },
    } as any);
    await waitForCondition(async () => failedTeamPushStatus === 503);

    // Client B creates a Street on canonical D1 while A's Team write is still
    // pending. A's independent Street replication must still pull it.
    const remoteStreet = await handleCampaignMutation(new Request("https://flyer.test/mutations", {
      method: "POST",
      body: JSON.stringify({
        mutation: {
          id: "mutation_rxdb_remote_street",
          campaignId,
          baseRevision: 3,
          createdAt: "2026-09-02T10:04:00.000Z",
          type: "task.create",
          payload: {
            taskId: "task_remote",
            areaId: "area_a",
            label: "Remote Street",
            geometry: { type: "LineString", coordinates: [[8.65, 49.42], [8.66, 49.43]] },
          },
        },
      }),
    }), db, campaignId, adminAccess);
    assert.equal(remoteStreet.status, 200, await remoteStreet.text());

    sync.refresh();
    await waitForCondition(async () => Boolean(await collections.streetTasks.findOne("task_remote").exec()));
    const localStreet = await collections.streetTasks.findOne("task_remote").exec();
    assert.equal(localStreet?.toJSON().label, "Remote Street");
  } finally {
    await sync.destroy();
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("one Campaign safety checkpoint recovers a missed signal without duplicate domain rows", async () => {
  const db = new SqliteD1();
  const safetyCampaignId = "campaign_rxdb-safety";
  const safetyAdminAccess: AccessContext = { ...adminAccess, campaignId: safetyCampaignId };
  seed(db, safetyCampaignId);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
  const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const hostSetInterval = globalThis.setInterval.bind(globalThis);
  const hostClearInterval = globalThis.clearInterval.bind(globalThis);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { setTimeout: hostSetTimeout, clearTimeout: hostClearTimeout, setInterval: hostSetInterval, clearInterval: hostClearInterval },
  });
  let checkpointCalls = 0;
  const safetyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://flyer.test");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.pathname.endsWith("/rxdb/checkpoint")) {
      checkpointCalls += 1;
      return handleRxdbCheckpoint(db, safetyCampaignId, safetyAdminAccess);
    }
    const parts = url.pathname.split("/");
    const operation = parts.at(-2);
    const collection = parts.at(-1) as "campaigns" | "teams" | "areas" | "streetTasks" | "houseTasks";
    if (operation === "pull") {
      return handleRxdbPull(db, safetyCampaignId, collection, safetyAdminAccess, body);
    }
    if (operation === "push") return handleRxdbPush(db, safetyCampaignId, collection, safetyAdminAccess, body);
    return new Response(null, { status: 404 });
  };
  const sync = new MissionRxdbSync({
    campaignId: safetyCampaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: safetyFetch,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  try {
    await sync.start();
    const collections = (sync as unknown as { collections: Record<string, any> }).collections;
    await waitForCondition(async () => Boolean(await collections.campaigns.findOne(safetyCampaignId).exec()));
    await waitForCondition(async () => Boolean(await collections.streetTasks.findOne("task_a").exec()));
    checkpointCalls = 0;
    const remoteStreet = await handleCampaignMutation(new Request("https://flyer.test/mutations", {
      method: "POST",
      body: JSON.stringify({
        mutation: {
          id: "mutation_rxdb_missed_signal",
          campaignId: safetyCampaignId,
          baseRevision: 3,
          createdAt: "2026-09-02T10:05:00.000Z",
          type: "task.create",
          payload: {
            taskId: "task_missed_signal",
            areaId: "area_a",
            label: "Recovered Street",
            geometry: { type: "LineString", coordinates: [[8.67, 49.42], [8.68, 49.43]] },
          },
        },
      }),
    }), db, safetyCampaignId, safetyAdminAccess);
    assert.equal(remoteStreet.status, 200, await remoteStreet.text());

    // Simulate a dropped WebSocket invalidation.  One high-water request is
    // enough to decide whether all five collection replications must catch up.
    await sync.safetyResync();
    assert.equal(checkpointCalls, 1);
    await waitForCondition(async () => Boolean(await collections.streetTasks.findOne("task_missed_signal").exec()));
    await sync.safetyResync();
    assert.equal(checkpointCalls, 2, "safety recovery must use one Campaign checkpoint per run");
    const recovered = await collections.streetTasks.find({ selector: { id: "task_missed_signal" } }).exec();
    assert.equal(recovered.length, 1, "replayed invalidations must not duplicate the domain row");
  } finally {
    await sync.destroy();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("global Campaign revision stays monotonic while stale Street writes and concurrent Team fields merge", async () => {
  const db = new SqliteD1();
  seed(db);
  const initialTeam = {
    id: "team_a",
    campaignId,
    name: "team_a",
    color: "#2563eb",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const teamNameWrite = await handleRxdbPush(db, campaignId, "teams", adminAccess, {
    rows: [{
      assumedMasterState: initialTeam,
      newDocumentState: { ...initialTeam, name: "Alpha" },
    }],
  });
  assert.equal(teamNameWrite.status, 200);
  const firstBody = await teamNameWrite.json() as { conflicts: unknown[]; rejections: unknown[] };
  assert.deepEqual(firstBody.rejections, []);

  // This client intentionally keeps the old global baseRevision (3).  The
  // Worker re-reads current D1 state and still accepts an independent Street.
  const staleStreet = await handleCampaignMutation(new Request("https://flyer.test/mutations", {
    method: "POST",
    body: JSON.stringify({
      mutation: {
        id: "mutation_rxdb_stale_global_revision",
        campaignId,
        baseRevision: 3,
        createdAt: "2026-09-02T10:06:00.000Z",
        type: "task.create",
        payload: {
          taskId: "task_stale_global_revision",
          areaId: "area_a",
          label: "Stale client street",
          geometry: { type: "LineString", coordinates: [[8.69, 49.42], [8.70, 49.43]] },
        },
      },
    }),
  }), db, campaignId, adminAccess);
  assert.equal(staleStreet.status, 200, await staleStreet.text());

  // A second client also started from the original Team document.  Its color
  // field is independent of the first client's name field and must merge.
  const teamColorWrite = await handleRxdbPush(db, campaignId, "teams", adminAccess, {
    rows: [{
      assumedMasterState: initialTeam,
      newDocumentState: { ...initialTeam, color: "#16a34a" },
    }],
  });
  assert.equal(teamColorWrite.status, 200);
  const finalSnapshot = await loadCampaignSnapshot(db, campaignId);
  assert.equal(finalSnapshot?.revision, 6);
  assert.deepEqual(
    finalSnapshot?.teams.find((team) => team.id === "team_a"),
    { ...initialTeam, name: "Alpha", color: "#16a34a", updatedAt: finalSnapshot?.teams.find((team) => team.id === "team_a")?.updatedAt },
  );
  assert.ok(finalSnapshot?.tasks.some((task) => task.id === "task_stale_global_revision"));
  const feed = db.sqlite.prepare("SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ?").get(campaignId) as { count: number };
  assert.ok(feed.count >= 3, "each accepted D1 mutation must leave a feed row");
});

test("Campaign and Team text/color bursts trail into one upstream window", async () => {
  const [sync, app, settings, store] = await Promise.all([
    readFile("src/data/rxdbMissionSync.ts", "utf8"),
    readFile("src/App.tsx", "utf8"),
    readFile("src/settings/SettingsSheet.tsx", "utf8"),
    readFile("src/data/campaignStore.ts", "utf8"),
  ]);
  assert.match(sync, /waitBeforePersist/u);
  assert.match(sync, /this\.release\(\), 900\)/u);
  assert.match(sync, /flushDebouncedWrites/u);
  assert.match(sync, /field-group-/u);
  assert.match(sync, /visibleAreaIds/u);
  assert.match(sync, /new WebSocketConstructor/u);
  assert.match(sync, /async safetyResync/u);
  assert.match(sync, /45_000/u);
  assert.match(app, /onBlur=\{\(\) => \{ normalizeTeamName\(team\); flushRxdbDrafts\(\); \}\}/u);
  assert.match(app, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Enter"\) flushRxdbDrafts\(\); \}\}/u);
  assert.match(settings, /onBlur=\{\(\) => \{ onNormalizeCampaignName\(\); onCommitCampaignDraft\(\); \}\}/u);
  assert.match(settings, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Enter"\) onCommitCampaignDraft\(\); \}\}/u);
  assert.match(app, /onClose=\{\(\) => \{ flushRxdbDrafts\(\); setSheet\(null\); \}\}/u);
  assert.match(store, /addEventListener\("online"[\s\S]*runtime\.sync\?\.refresh\(\)/u);
  assert.match(store, /visibilitychange[\s\S]*runtime\.sync\?\.refresh\(\)/u);

  const teamWrites = await countTrailingWrites(Array.from({ length: 20 }, (_, index) => `Team ${index + 1}`));
  const campaignWrites = await countTrailingWrites(Array.from({ length: 20 }, (_, index) => `Campaign ${index + 1}`));
  const colorWrites = await countTrailingWrites(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);
  assert.equal(teamWrites, 1, "20 Team characters must produce one upstream write");
  assert.equal(campaignWrites, 1, "20 Campaign characters must produce one upstream write");
  assert.equal(colorWrites, 1, "6 color changes must produce one upstream write");

  const actualTeamWrites = await countActualReplicationWrites(
    "teams",
    Array.from({ length: 20 }, (_, index) => `Team ${index + 1}`),
    (value, index, campaignId) => ({
      id: `mutation_rxdb_team_burst_${index}`,
      campaignId,
      baseRevision: 3,
      createdAt: `2026-09-02T11:00:${String(index).padStart(2, "0")}.000Z`,
      type: "team.update",
      payload: { teamId: "team_a", name: value, expectedUpdatedAt: timestamp },
    }),
  );
  const actualCampaignWrites = await countActualReplicationWrites(
    "campaigns",
    Array.from({ length: 20 }, (_, index) => `Campaign ${index + 1}`),
    (value, index, campaignId) => ({
      id: `mutation_rxdb_campaign_burst_${index}`,
      campaignId,
      baseRevision: 3,
      createdAt: `2026-09-02T12:00:${String(index).padStart(2, "0")}.000Z`,
      type: "campaign.rename",
      payload: { name: value, expectedName: "Campaign" },
    }),
  );
  const actualColorWrites = await countActualReplicationWrites(
    "teams",
    ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
    (value, index, campaignId) => ({
      id: `mutation_rxdb_color_burst_${index}`,
      campaignId,
      baseRevision: 3,
      createdAt: `2026-09-02T13:00:${String(index).padStart(2, "0")}.000Z`,
      type: "team.update",
      payload: { teamId: "team_a", color: value, expectedUpdatedAt: timestamp },
    }),
  );
  assert.equal(actualTeamWrites, 1, "the RxDB Team replication must emit one upstream write for 20 characters");
  assert.equal(actualCampaignWrites, 1, "the RxDB Campaign replication must emit one upstream write for 20 characters");
  assert.equal(actualColorWrites, 1, "the RxDB Team replication must emit one upstream write for 6 colors");
});
