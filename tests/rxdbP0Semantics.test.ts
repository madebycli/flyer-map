import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { addRxPlugin, createRxDatabase } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { MissionRxdbSync, RxdbSyncHttpError } from "../src/data/rxdbMissionSync.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleRxdbPull, handleRxdbPush } from "../worker/rxdbSync.ts";

addRxPlugin(RxDBDevModePlugin);

const collectionNames = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];
const timestamp = "2026-09-02T10:00:00.000Z";

class TestObservable<T> {
  private readonly handlers = new Set<(value: T) => void>();

  subscribe(handler: (value: T) => void) {
    this.handlers.add(handler);
    return { unsubscribe: () => this.handlers.delete(handler) };
  }

  emit(value: T) {
    for (const handler of this.handlers) handler(value);
  }
}

type FakeReplication = {
  error$: TestObservable<unknown>;
  received$: TestObservable<void>;
  sent$: TestObservable<void>;
  reSync(): void;
  cancel(): Promise<void>;
};

function makeFakeReplication(onResync: () => void = () => undefined): FakeReplication {
  return {
    error$: new TestObservable<unknown>(),
    received$: new TestObservable<void>(),
    sent$: new TestObservable<void>(),
    reSync: onResync,
    async cancel() {},
  };
}

function installWindow() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, String(value)); },
  } satisfies Storage;
  const fakeWindow = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    localStorage: storage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: fakeWindow });
  return {
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

async function waitForCondition(check: () => Promise<boolean> | boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

function refreshHarness(checkpointResponse: () => Response | Promise<Response>) {
  const sync = new MissionRxdbSync({
    campaignId: "campaign_refresh_truth",
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: async (input) => {
      const url = new URL(String(input), "https://flyer.test");
      if (url.pathname.endsWith("/rxdb/checkpoint")) return checkpointResponse();
      return new Response(null, { status: 404 });
    },
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  const internal = sync as unknown as {
    initialized: boolean;
    checkpoints: Map<RxdbCollectionName, number>;
    replications: Map<RxdbCollectionName, FakeReplication>;
  };
  internal.initialized = true;
  for (const collectionName of collectionNames) internal.replications.set(collectionName, makeFakeReplication());
  return { sync, internal };
}

test("refreshAndWait is truthful across all five collection checkpoints", async () => {
  const browser = installWindow();
  try {
    const { sync, internal } = refreshHarness(() => Response.json({ checkpoint: { seq: 120 }, campaignRevision: 9 }));
    internal.checkpoints.set("campaigns", 120);
    internal.checkpoints.set("teams", 120);
    internal.checkpoints.set("areas", 120);
    internal.checkpoints.set("houseTasks", 120);
    internal.checkpoints.set("streetTasks", 105);

    let settled = false;
    const refresh = sync.refreshAndWait(500).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(settled, false, "four current collections must not make refresh current while one collection is behind");

    internal.checkpoints.set("streetTasks", 120);
    internal.replications.get("streetTasks")?.received$.emit(undefined);
    const target = await refresh;
    assert.deepEqual(target, { seq: 120, campaignRevision: 9 });
  } finally {
    browser.restore();
  }
});

test("refreshAndWait never reports success through a checkpoint network failure", async () => {
  const browser = installWindow();
  try {
    const { sync } = refreshHarness(() => Response.json({ error: { code: "network_error", message: "offline" } }, { status: 503 }));
    await assert.rejects(
      () => sync.refreshAndWait(100),
      (error: unknown) => error instanceof RxdbSyncHttpError && error.code === "network_error",
    );
  } finally {
    browser.restore();
  }
});

test("a follower-style refresh without leadership is bounded instead of hanging forever", async () => {
  const browser = installWindow();
  try {
    const { sync, internal } = refreshHarness(() => Response.json({ checkpoint: { seq: 40 }, campaignRevision: 4 }));
    for (const collectionName of collectionNames) internal.checkpoints.set(collectionName, 39);
    const startedAt = Date.now();
    await assert.rejects(
      () => sync.refreshAndWait(60),
      (error: unknown) => error instanceof RxdbSyncHttpError && error.code === "rxdb_refresh_timeout",
    );
    assert.ok(Date.now() - startedAt < 1_000, "follower refresh must fail boundedly instead of awaiting RxDB leadership forever");
  } finally {
    browser.restore();
  }
});

type MissionDocument = Record<string, unknown> & { id: string; campaignId: string };

class FakeMissionServer {
  seq = 0;
  revision = 3;
  readonly online = new Map<string, boolean>();
  readonly failedPushes = new Map<string, number>();
  readonly pushes: Array<{ actor: string; collectionName: RxdbCollectionName; rows: Array<{ newDocumentState: MissionDocument }> }> = [];
  readonly documents: Record<RxdbCollectionName, MissionDocument[]>;

  constructor(readonly campaignId: string) {
    const team = { id: "team_a", campaignId, name: "Team A", color: "#2563eb", createdAt: timestamp, updatedAt: timestamp };
    const area = {
      id: "area_a", campaignId, teamId: "team_a", name: "Area A",
      geometry: { type: "Polygon", coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] },
      createdAt: timestamp, updatedAt: timestamp,
    };
    const task = (id: string) => ({
      id, campaignId, areaId: "area_a", taskType: "street", label: id,
      geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] },
      areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
    });
    this.documents = {
      campaigns: [{ id: campaignId, campaignId, name: "Mission", status: "active", defaultMapView: null, createdAt: timestamp, updatedAt: timestamp }],
      teams: [team],
      areas: [area],
      streetTasks: [task("task_a"), task("task_b")],
      houseTasks: [],
    };
  }

  fetchFor(actor: string): typeof fetch {
    return async (input, init) => {
      const url = new URL(String(input), "https://flyer.test");
      if (url.pathname.endsWith("/rxdb/checkpoint")) {
        return Response.json({ checkpoint: { seq: this.seq }, campaignRevision: this.revision });
      }
      const parts = url.pathname.split("/");
      const operation = parts.at(-2);
      const collectionName = parts.at(-1) as RxdbCollectionName;
      if (!collectionNames.includes(collectionName)) return new Response(null, { status: 404 });
      if (operation === "pull") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as { checkpoint?: { seq?: number } | null } : {};
        const checkpoint = body.checkpoint?.seq;
        const documents = checkpoint === undefined || body.checkpoint === null
          ? this.documents[collectionName]
          : checkpoint < this.seq && collectionName === "streetTasks"
            ? this.documents.streetTasks
            : [];
        return Response.json({ documents, checkpoint: { seq: this.seq }, campaignRevision: this.revision });
      }
      if (operation === "push") {
        if (this.online.get(actor) === false) {
          this.failedPushes.set(actor, (this.failedPushes.get(actor) ?? 0) + 1);
          throw new TypeError("network_lost");
        }
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body) as { rows: Array<{ newDocumentState: MissionDocument }> }
          : { rows: [] };
        this.pushes.push({ actor, collectionName, rows: body.rows });
        for (const row of body.rows) {
          const next = row.newDocumentState;
          const index = this.documents[collectionName].findIndex((document) => document.id === next.id);
          if (next._deleted === true) {
            if (index >= 0) this.documents[collectionName].splice(index, 1);
          } else if (index >= 0) {
            this.documents[collectionName][index] = { ...next };
          } else {
            this.documents[collectionName].push({ ...next });
          }
          this.seq += 1;
          this.revision += 1;
        }
        return Response.json({ conflicts: [], rejections: [] });
      }
      return new Response(null, { status: 404 });
    };
  }
}

function collectionsOf(sync: MissionRxdbSync) {
  return (sync as unknown as { collections: Record<string, any> }).collections;
}

function taskStatus(server: FakeMissionServer, taskId: string) {
  return server.documents.streetTasks.find((document) => document.id === taskId)?.status;
}

function statusMutation(campaignId: string, taskId: string, status: "completed" | "later", suffix: string) {
  const completedAt = status === "completed" ? `2026-09-02T10:0${suffix}:00.000Z` : null;
  return {
    id: `mutation_${suffix}_${taskId}`,
    campaignId,
    baseRevision: 3,
    createdAt: `2026-09-02T10:0${suffix}:00.000Z`,
    type: "task.set-status" as const,
    payload: { taskId, status, completedAt, expectedUpdatedAt: timestamp },
  };
}

test("Field Group A offline intent remains isolated from Group B and resumes only as A", async () => {
  const browser = installWindow();
  const storage = getRxStorageMemory();
  const campaignId = `campaign_actor_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const server = new FakeMissionServer(campaignId);
  server.online.set("group_a", true);
  server.online.set("group_b", true);

  const makeSync = (actorScopeId: string) => new MissionRxdbSync({
    campaignId,
    teamScopeId: "team_a",
    actorScopeId,
    storage,
    multiInstance: false,
    fetchImpl: server.fetchFor(actorScopeId),
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });

  let syncA = makeSync("group_a");
  let syncB: MissionRxdbSync | null = null;
  try {
    await syncA.start();
    await waitForCondition(async () => Boolean(await collectionsOf(syncA).streetTasks.findOne("task_a").exec()));
    server.online.set("group_a", false);
    await syncA.applyMutation(statusMutation(campaignId, "task_a", "completed", "1"));
    await waitForCondition(() => (server.failedPushes.get("group_a") ?? 0) > 0);
    assert.equal(taskStatus(server, "task_a"), "open");
    await syncA.destroy();

    syncB = makeSync("group_b");
    await syncB.start();
    await waitForCondition(async () => Boolean(await collectionsOf(syncB!).streetTasks.findOne("task_a").exec()));
    const bTaskA = await collectionsOf(syncB).streetTasks.findOne("task_a").exec();
    assert.equal(bTaskA?.toJSON().status, "open", "B must bootstrap canonical server data, not A's actor-scoped offline cache");
    assert.equal(server.pushes.some((push) => push.actor === "group_b" && push.rows.some((row) => row.newDocumentState.id === "task_a" && row.newDocumentState.status === "completed")), false);

    await syncB.applyMutation(statusMutation(campaignId, "task_b", "later", "2"));
    await waitForCondition(() => taskStatus(server, "task_b") === "later");
    assert.ok(server.pushes.some((push) => push.actor === "group_b" && push.rows.some((row) => row.newDocumentState.id === "task_b" && row.newDocumentState.status === "later")), "B must remain able to push its own independent intent");
    assert.equal(taskStatus(server, "task_a"), "open");
    await syncB.destroy();
    syncB = null;

    server.online.set("group_a", true);
    syncA = makeSync("group_a");
    await syncA.start();
    await waitForCondition(() => taskStatus(server, "task_a") === "completed");
    assert.ok(server.pushes.some((push) => push.actor === "group_a" && push.rows.some((row) => row.newDocumentState.id === "task_a" && row.newDocumentState.status === "completed")), "A's durable local intent must resume under A");
    assert.equal(server.pushes.some((push) => push.actor === "group_b" && push.rows.some((row) => row.newDocumentState.id === "task_a" && row.newDocumentState.status === "completed")), false, "A's intent must never be uploaded as B");
  } finally {
    await syncB?.destroy();
    try { await syncA.destroy(); } catch {}
    browser.restore();
  }
});

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

function seedD1(db: SqliteD1, campaignId: string) {
  db.sqlite.prepare("INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, 'Mission', 'active', 3, 'seed', ?, ?)").run(campaignId, timestamp, timestamp);
  db.sqlite.prepare("INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES ('team_a', ?, 'Team A', '#2563eb', ?, ?)").run(campaignId, timestamp, timestamp);
  db.sqlite.prepare("INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES ('area_a', ?, 'team_a', 'Area A', ?, ?, ?)").run(campaignId, JSON.stringify({ type: "Polygon", coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] }), timestamp, timestamp);
  db.sqlite.prepare("INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at) VALUES ('task_a', ?, 'area_a', 'street', 'Street A', ?, 'open', NULL, ?, ?)").run(campaignId, JSON.stringify({ type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] }), timestamp, timestamp);
}

test("lost HTTP response after committed RxDB push retries to exactly one domain effect", async () => {
  const db = new SqliteD1();
  const campaignId = `campaign_lost_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  seedD1(db, campaignId);
  const access: AccessContext = { grantId: "grant_admin", campaignId, role: "admin", teamId: null, label: "Admin" };
  const assumed = {
    id: "task_a", campaignId, areaId: "area_a", taskType: "street", label: "Street A",
    geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] },
    areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
  };
  const next = { ...assumed, status: "completed", completedAt: "2026-09-02T10:01:00.000Z", updatedAt: "2026-09-02T10:01:00.000Z" };
  const body = { rows: [{ assumedMasterState: assumed, newDocumentState: next }] };

  const firstResponse = await handleRxdbPush(db, campaignId, "streetTasks", access, body);
  assert.equal(firstResponse.status, 200);
  const afterFirst = await loadCampaignSnapshot(db, campaignId);
  const feedAfterFirst = db.sqlite.prepare("SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ?").get(campaignId) as { count: number };
  assert.equal(afterFirst?.revision, 4);
  assert.equal(afterFirst?.tasks.find((task) => task.id === "task_a")?.status, "completed");
  assert.equal(feedAfterFirst.count, 1);

  const retryResponse = await handleRxdbPush(db, campaignId, "streetTasks", access, body);
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as { conflicts: unknown[]; rejections: unknown[] };
  assert.deepEqual(retryBody, { conflicts: [], rejections: [] });
  const afterRetry = await loadCampaignSnapshot(db, campaignId);
  const feedAfterRetry = db.sqlite.prepare("SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ?").get(campaignId) as { count: number };
  assert.equal(afterRetry?.revision, 4, "retry must not apply a second domain mutation");
  assert.equal(feedAfterRetry.count, 1, "retry must not append a duplicate feed row");

  const pull = await handleRxdbPull(db, campaignId, "streetTasks", access, { checkpoint: { seq: 0 }, batchSize: 100 });
  const pulled = await pull.json() as { documents: Array<{ id: string; status: string }> };
  assert.deepEqual(pulled.documents.map((document) => ({ id: document.id, status: document.status })), [{ id: "task_a", status: "completed" }]);
});

test("two RxDB tabs elect one replication leader and leader handover does not duplicate writes", async () => {
  const campaignId = `campaign_tabs_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const storage = getRxStorageMemory();
  const schema = {
    version: 0,
    primaryKey: "id",
    type: "object",
    properties: {
      id: { type: "string", maxLength: 200 },
      campaignId: { type: "string", maxLength: 200 },
      status: { type: "string" },
      updatedAt: { type: "string" },
    },
    required: ["id", "campaignId", "status", "updatedAt"],
    additionalProperties: false,
  } as const;
  const databaseName = `mission-multitab-${campaignId}`;
  const db1 = await createRxDatabase({ name: databaseName, storage, multiInstance: true, eventReduce: true, ignoreDuplicate: true });
  const db2 = await createRxDatabase({ name: databaseName, storage, multiInstance: true, eventReduce: true, ignoreDuplicate: true });
  const c1 = (await db1.addCollections({ tasks: { schema } })).tasks;
  const c2 = (await db2.addCollections({ tasks: { schema } })).tasks;
  const remote = new Map<string, { id: string; campaignId: string; status: string; updatedAt: string }>();
  let pushRows = 0;
  const makeReplication = (collection: typeof c1) => replicateRxCollection<{ id: string; campaignId: string; status: string; updatedAt: string }, { seq: number }>({
    replicationIdentifier: `mission-multitab:${campaignId}`,
    collection,
    pull: { batchSize: 20, handler: async () => ({ documents: [], checkpoint: { seq: 0 } }) },
    push: {
      batchSize: 20,
      handler: async (rows) => {
        for (const row of rows) {
          pushRows += 1;
          if (row.newDocumentState._deleted) remote.delete(row.newDocumentState.id);
          else remote.set(row.newDocumentState.id, {
            id: row.newDocumentState.id,
            campaignId: row.newDocumentState.campaignId,
            status: row.newDocumentState.status,
            updatedAt: row.newDocumentState.updatedAt,
          });
        }
        return [];
      },
    },
    live: true,
    retryTime: 20,
    waitForLeadership: true,
  });
  const r1 = makeReplication(c1);
  const r2 = makeReplication(c2);
  let closed1 = false;
  let closed2 = false;
  try {
    const leader = await Promise.race([
      db1.waitForLeadership().then(() => 1 as const),
      db2.waitForLeadership().then(() => 2 as const),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("leader_timeout")), 2_000)),
    ]);
    const followerCollection = leader === 1 ? c2 : c1;
    await followerCollection.insert({ id: "task_tab", campaignId, status: "open", updatedAt: timestamp });
    await waitForCondition(() => remote.get("task_tab")?.status === "open");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pushRows, 1, "only the elected tab may push the first local write");
    const followerVisible = await followerCollection.findOne("task_tab").exec();
    assert.equal(followerVisible?.get("status"), "open", "the follower must see shared local data");

    if (leader === 1) {
      await r1.cancel();
      await db1.close();
      closed1 = true;
      await Promise.race([db2.waitForLeadership(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handover_timeout")), 2_000))]);
    } else {
      await r2.cancel();
      await db2.close();
      closed2 = true;
      await Promise.race([db1.waitForLeadership(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handover_timeout")), 2_000))]);
    }
    const remainingCollection = leader === 1 ? c2 : c1;
    const document = await remainingCollection.findOne("task_tab").exec(true);
    await document.incrementalPatch({ status: "later", updatedAt: "2026-09-02T10:02:00.000Z" });
    await waitForCondition(() => remote.get("task_tab")?.status === "later");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pushRows, 2, "leader handover must add exactly one domain write, not duplicate it");
  } finally {
    await r1.cancel().catch(() => undefined);
    await r2.cancel().catch(() => undefined);
    if (!closed1) await db1.close().catch(() => undefined);
    if (!closed2) await db2.close().catch(() => undefined);
  }
});
