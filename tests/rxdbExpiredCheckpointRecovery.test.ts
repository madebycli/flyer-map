import assert from "node:assert/strict";
import test from "node:test";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { MissionRxdbSync, type RxdbSyncIssue } from "../src/data/rxdbMissionSync.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";

const collections = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];
const timestamp = "2026-09-14T18:00:00.000Z";
type WireDocument = Record<string, unknown> & { id: string; campaignId: string; _deleted?: boolean };

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
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
    },
  });
  return {
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

class RetentionServer {
  revision = 1;
  pushOnline = true;
  retentionFloor = 0;
  expiredResponses = 0;
  failedPushes = 0;
  readonly pushedIds: string[] = [];
  readonly heads = new Map<RxdbCollectionName, number>(collections.map((name) => [name, 10]));
  readonly documents: Record<RxdbCollectionName, WireDocument[]>;

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
      source: null,
      network: {},
      areaPreparationGeneration: null,
      status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
    });
    this.documents = {
      campaigns: [{ id: campaignId, campaignId, name: "Mission", status: "active", defaultMapView: null, createdAt: timestamp, updatedAt: timestamp }],
      teams: [team],
      areas: [area],
      streetTasks: [task("task_keep"), task("task_deleted")],
      houseTasks: [],
    };
  }

  compactStreetFeed() {
    this.documents.streetTasks = this.documents.streetTasks.filter((document) => document.id !== "task_deleted");
    this.documents.streetTasks.push({
      id: "task_new", campaignId: this.campaignId, areaId: "area_a", taskType: "street", label: "task_new",
      geometry: { type: "LineString", coordinates: [[8.63, 49.43], [8.64, 49.44]] }, source: null, network: {},
      areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
    });
    this.retentionFloor = 15;
    this.heads.set("streetTasks", 20);
    this.revision += 1;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://flyer.test");
    if (url.pathname.endsWith("/rxdb/checkpoint")) {
      return Response.json({
        checkpoint: { seq: Math.max(...this.heads.values()) },
        campaignRevision: this.revision,
        collections: Object.fromEntries(this.heads),
      });
    }
    const parts = url.pathname.split("/");
    const operation = parts.at(-2);
    const collectionName = parts.at(-1) as RxdbCollectionName;
    if (!collections.includes(collectionName)) return new Response(null, { status: 404 });
    if (operation === "pull") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { checkpoint?: { seq?: number } | null };
      const checkpoint = body.checkpoint?.seq;
      if (collectionName === "streetTasks" && checkpoint !== undefined && checkpoint < this.retentionFloor) {
        this.expiredResponses += 1;
        return Response.json({
          error: { code: "rxdb_checkpoint_expired", message: "expired" },
          retention: { minCheckpointSeq: this.retentionFloor, epoch: 2 },
        }, { status: 409 });
      }
      return Response.json({
        documents: body.checkpoint === null || checkpoint === undefined || checkpoint < (this.heads.get(collectionName) ?? 0)
          ? this.documents[collectionName]
          : [],
        checkpoint: { seq: this.heads.get(collectionName) ?? 0 },
        campaignRevision: this.revision,
      });
    }
    if (operation === "push") {
      if (!this.pushOnline) {
        this.failedPushes += 1;
        throw new TypeError("network_lost");
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { rows?: Array<{ newDocumentState: WireDocument }> };
      for (const row of body.rows ?? []) {
        const next = row.newDocumentState;
        this.pushedIds.push(next.id);
        const target = this.documents[collectionName];
        const index = target.findIndex((document) => document.id === next.id);
        if (next._deleted) {
          if (index >= 0) target.splice(index, 1);
        } else if (index >= 0) target[index] = { ...next };
        else target.push({ ...next });
        this.heads.set(collectionName, (this.heads.get(collectionName) ?? 0) + 1);
        this.revision += 1;
      }
      return Response.json({ conflicts: [], rejections: [] });
    }
    return new Response(null, { status: 404 });
  };
}

function internalCollections(sync: MissionRxdbSync) {
  return (sync as unknown as { collections: Record<RxdbCollectionName, { findOne(id: string): { exec(): Promise<{ toJSON(): WireDocument } | null> } }> }).collections;
}

function statusMutation(campaignId: string) {
  return {
    id: "mutation_offline_keep",
    campaignId,
    baseRevision: 1,
    createdAt: "2026-09-14T18:01:00.000Z",
    type: "task.set-status" as const,
    payload: {
      taskId: "task_keep",
      status: "completed" as const,
      completedAt: "2026-09-14T18:01:00.000Z",
      expectedUpdatedAt: timestamp,
    },
  };
}

test("expired checkpoint drains pending writes before a clean bootstrap and cannot resurrect compacted deletes", async () => {
  const browser = installWindow();
  const storage = getRxStorageMemory();
  const campaignId = `campaign_retention_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const server = new RetentionServer(campaignId);
  const issues: RxdbSyncIssue[] = [];

  const makeSync = () => new MissionRxdbSync({
    campaignId,
    storage,
    multiInstance: false,
    fetchImpl: server.fetch,
    onSnapshot: () => undefined,
    onIssue: (issue) => {
      issues.push(issue);
      if (issue.code === "rxdb_checkpoint_expired") server.pushOnline = true;
    },
  });

  let sync = makeSync();
  try {
    await sync.start();
    await waitFor(async () => Boolean(await internalCollections(sync).streetTasks.findOne("task_deleted").exec()));

    server.pushOnline = false;
    await sync.applyMutation(statusMutation(campaignId));
    await waitFor(() => server.failedPushes > 0);
    server.compactStreetFeed();
    await sync.destroy();

    sync = makeSync();
    await sync.start();

    await waitFor(() => server.expiredResponses > 0);
    await waitFor(() => server.documents.streetTasks.some((document) => document.id === "task_keep" && document.status === "completed"));
    await waitFor(async () => Boolean(await internalCollections(sync).streetTasks.findOne("task_new").exec()));
    await waitFor(async () => !(await internalCollections(sync).streetTasks.findOne("task_deleted").exec()));

    assert.ok(issues.some((issue) => issue.code === "rxdb_checkpoint_expired"), "the runtime must observe the expired checkpoint");
    assert.equal(server.pushedIds.includes("task_deleted"), false, "the stale compacted task must never be pushed back to the server");
    assert.equal(server.documents.streetTasks.some((document) => document.id === "task_deleted"), false, "the compacted delete must remain deleted canonically");
  } finally {
    await sync.destroy().catch(() => undefined);
    browser.restore();
  }
});
