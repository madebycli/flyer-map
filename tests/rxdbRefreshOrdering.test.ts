import assert from "node:assert/strict";
import test from "node:test";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { MissionRxdbSync } from "../src/data/rxdbMissionSync.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";

const timestamp = "2026-09-10T07:45:00.000Z";
const collections = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];
type Doc = Record<string, unknown> & { id: string; campaignId: string };

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
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

class OrderingServer {
  seq = 0;
  revision = 1;
  pushStarted = false;
  pushCompleted = false;
  readonly docs: Record<RxdbCollectionName, Doc[]>;

  constructor(readonly campaignId: string) {
    this.docs = {
      campaigns: [{ id: campaignId, campaignId, name: "Mission", status: "active", defaultMapView: null, createdAt: timestamp, updatedAt: timestamp }],
      teams: [{ id: "team_a", campaignId, name: "Server alt", color: "#2563eb", createdAt: timestamp, updatedAt: timestamp }],
      areas: [],
      streetTasks: [],
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
    if (!collections.includes(collectionName)) return new Response(null, { status: 404 });

    if (operation === "pull") {
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { checkpoint?: { seq?: number } | null }
        : {};
      const checkpoint = body.checkpoint?.seq;
      const behind = body.checkpoint === null || checkpoint === undefined || checkpoint < this.seq;
      return Response.json({
        documents: behind ? this.docs[collectionName] : [],
        checkpoint: { seq: this.seq },
        campaignRevision: this.revision,
      });
    }

    if (operation === "push") {
      this.pushStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { rows: Array<{ newDocumentState: Doc }> }
        : { rows: [] };
      for (const row of body.rows) {
        const next = row.newDocumentState;
        const index = this.docs[collectionName].findIndex((doc) => doc.id === next.id);
        if (next._deleted === true) {
          if (index >= 0) this.docs[collectionName].splice(index, 1);
        } else if (index >= 0) this.docs[collectionName][index] = { ...next };
        else this.docs[collectionName].push({ ...next });
        this.seq += 1;
        this.revision += 1;
      }
      this.pushCompleted = true;
      return Response.json({ conflicts: [], rejections: [] });
    }

    return new Response(null, { status: 404 });
  };
}

test("explicit refresh cannot complete before an already accepted local RxDB write is pushed", async () => {
  const restoreWindow = installWindow();
  const campaignId = `campaign_refresh_order_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const server = new OrderingServer(campaignId);
  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: server.fetch,
    onSnapshot: () => undefined,
    onIssue: () => undefined,
  });

  try {
    await sync.start();
    await sync.refreshAndWait(1_000);

    await sync.applyMutation({
      id: "mutation_team_local_before_refresh",
      campaignId,
      baseRevision: 1,
      createdAt: "2026-09-10T07:46:00.000Z",
      type: "team.update",
      payload: { teamId: "team_a", name: "Lokaler neuer Stand", expectedUpdatedAt: timestamp },
    });

    let refreshSettled = false;
    const refresh = sync.refreshAndWait(2_500).then((result) => {
      refreshSettled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(refreshSettled, false, "refresh must not report current while the local write is still waiting for its push gate");

    await waitFor(() => server.pushStarted);
    assert.equal(refreshSettled, false, "refresh must stay pending while the server has not acknowledged the local write");

    const target = await refresh;
    assert.equal(server.pushCompleted, true);
    assert.equal(server.docs.teams[0]?.name, "Lokaler neuer Stand");
    assert.ok(target.seq >= 1, "refresh target must include the acknowledged local mutation");
  } finally {
    await sync.destroy();
    restoreWindow();
  }
});
