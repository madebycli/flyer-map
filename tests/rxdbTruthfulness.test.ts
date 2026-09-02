import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { MissionRxdbSync, type RxdbRemoteSyncEvent } from "../src/data/rxdbMissionSync.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";

const timestamp = "2026-09-02T10:00:00.000Z";
const collectionNames = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];
type MissionDocument = Record<string, unknown> & { id: string; campaignId: string };

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

async function waitForCondition(check: () => Promise<boolean> | boolean, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

class TruthServer {
  seq = 0;
  revision = 3;
  blockTeamPush = false;
  failedTeamPushes = 0;
  targetStreetPulls = 0;
  readonly documents: Record<RxdbCollectionName, MissionDocument[]>;

  constructor(readonly campaignId: string) {
    this.documents = {
      campaigns: [{ id: campaignId, campaignId, name: "Mission", status: "active", defaultMapView: null, createdAt: timestamp, updatedAt: timestamp }],
      teams: [{ id: "team_a", campaignId, name: "Team A", color: "#2563eb", createdAt: timestamp, updatedAt: timestamp }],
      areas: [{
        id: "area_a", campaignId, teamId: "team_a", name: "Area A",
        geometry: { type: "Polygon", coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] },
        createdAt: timestamp, updatedAt: timestamp,
      }],
      streetTasks: [{
        id: "task_a", campaignId, areaId: "area_a", taskType: "street", label: "Task A",
        geometry: { type: "LineString", coordinates: [[8.61, 49.41], [8.62, 49.42]] },
        areaPreparationGeneration: null, status: "open", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
      }],
      houseTasks: [],
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
      const behind = body.checkpoint === null || checkpoint === undefined || checkpoint < this.seq;
      const documents = behind ? this.documents[collectionName] : [];
      if (collectionName === "streetTasks" && this.seq > 0 && behind) this.targetStreetPulls += 1;
      return Response.json({ documents, checkpoint: { seq: this.seq }, campaignRevision: this.revision });
    }
    if (operation === "push") {
      if (collectionName === "teams" && this.blockTeamPush) {
        this.failedTeamPushes += 1;
        throw new TypeError("team_network_retry");
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { rows: Array<{ newDocumentState: MissionDocument }> }
        : { rows: [] };
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

function teamName(server: TruthServer) {
  return server.documents.teams.find((document) => document.id === "team_a")?.name;
}

function streetStatus(server: TruthServer) {
  return server.documents.streetTasks.find((document) => document.id === "task_a")?.status;
}

test("an independent sent document cannot globally confirm while another RxDB push is retrying", async () => {
  const browser = installWindow();
  const campaignId = `campaign_ack_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const server = new TruthServer(campaignId);
  const events: RxdbRemoteSyncEvent[] = [];
  let state: "waiting-server" | "server-confirmed" = "waiting-server";
  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: server.fetch,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
    onRemoteEvent: (event) => {
      events.push(event);
      if (event === "push-pending") state = "waiting-server";
      if (event === "push-idle") state = "server-confirmed";
    },
  });
  try {
    await sync.start();
    await sync.refreshAndWait(1_000);
    events.length = 0;

    server.blockTeamPush = true;
    await sync.applyMutation({
      id: "mutation_team_waiting",
      campaignId,
      baseRevision: 3,
      createdAt: "2026-09-02T10:01:00.000Z",
      type: "team.update",
      payload: { teamId: "team_a", name: "Team A waiting", expectedUpdatedAt: timestamp },
    });
    sync.flushDebouncedWrites();
    await waitForCondition(() => server.failedTeamPushes > 0);
    assert.equal(state, "waiting-server");

    await sync.applyMutation({
      id: "mutation_street_success",
      campaignId,
      baseRevision: 3,
      createdAt: "2026-09-02T10:02:00.000Z",
      type: "task.set-status",
      payload: { taskId: "task_a", status: "later", completedAt: null, expectedUpdatedAt: timestamp },
    });
    await waitForCondition(() => streetStatus(server) === "later");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(state, "waiting-server", "a successful Street sent$ must not hide the still-retrying Team write");
    assert.equal(events.includes("push-idle"), false, "global acknowledgement must remain pending while any concrete local RxDB document is unconfirmed");

    server.blockTeamPush = false;
    await waitForCondition(() => teamName(server) === "Team A waiting", 5_000);
    await waitForCondition(() => events.includes("push-idle"));
    assert.equal(state, "server-confirmed");
  } finally {
    await sync.destroy();
    browser.restore();
  }
});

test("refreshAndWait cannot pass a high-water checkpoint before pulled documents are applied", async () => {
  const browser = installWindow();
  const campaignId = `campaign_apply_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const server = new TruthServer(campaignId);
  const baseStorage = getRxStorageMemory();
  let delayStreetWrites = false;
  let delayedStreetWriteSeen = false;
  let releaseStreetWrite: (() => void) | null = null;
  let streetWriteGate = Promise.resolve();
  const resetGate = () => {
    streetWriteGate = new Promise<void>((resolve) => { releaseStreetWrite = resolve; });
  };
  const storage = {
    ...baseStorage,
    async createStorageInstance(params: Parameters<typeof baseStorage.createStorageInstance>[0]) {
      const instance = await baseStorage.createStorageInstance(params);
      if (params.collectionName !== "streetTasks") return instance;
      return new Proxy(instance, {
        get(target, property, receiver) {
          if (property === "bulkWrite") {
            return async (...args: Parameters<typeof instance.bulkWrite>) => {
              if (delayStreetWrites) {
                delayedStreetWriteSeen = true;
                await streetWriteGate;
              }
              return target.bulkWrite(...args);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const sync = new MissionRxdbSync({
    campaignId,
    storage,
    multiInstance: false,
    fetchImpl: server.fetch,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });
  try {
    await sync.start();
    await sync.refreshAndWait(1_000);

    server.seq = 10;
    server.revision = 10;
    server.documents.streetTasks[0] = { ...server.documents.streetTasks[0], label: "Applied only after gate", updatedAt: "2026-09-02T10:10:00.000Z" };
    resetGate();
    delayStreetWrites = true;

    let settled = false;
    const refresh = sync.refreshAndWait(2_000).then((value) => {
      settled = true;
      return value;
    });
    await waitForCondition(() => server.targetStreetPulls > 0 && delayedStreetWriteSeen);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(settled, false, "the pull response checkpoint must not count as applied while RxDB fork persistence is blocked");

    delayStreetWrites = false;
    releaseStreetWrite?.();
    const target = await refresh;
    assert.deepEqual(target, { seq: 10, campaignRevision: 10 });
  } finally {
    releaseStreetWrite?.();
    await sync.destroy();
    browser.restore();
  }
});

test("campaign store keeps pull-current and push-confirmed as independent states", () => {
  const source = readFileSync(new URL("../src/data/campaignStore.ts", import.meta.url), "utf8");
  assert.match(source, /event === "push-pending"/);
  assert.match(source, /event === "push-idle"/);
  assert.doesNotMatch(source, /event !== "sent"[\s\S]{0,300}runtime\.pendingWrites[\s\S]{0,200}"server-confirmed"/);
  const manualRefreshBlock = source.slice(source.indexOf("async function runManualRefresh"), source.indexOf("export function manualRefreshCampaign"));
  assert.doesNotMatch(manualRefreshBlock, /syncState:\s*"server-confirmed"/);
});
