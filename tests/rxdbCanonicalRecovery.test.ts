import assert from "node:assert/strict";
import test from "node:test";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { MissionRxdbSync } from "../src/data/rxdbMissionSync.ts";

const timestamp = "2026-09-18T18:00:00.000Z";

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition_timeout");
}

test("startup canonical Area probe reboots a replica that retained a deleted Area past its checkpoint", async () => {
  const campaignId = "campaign_canonical_recovery";
  const teamId = "team_a";
  const oldArea = {
    id: "area_deleted_old",
    campaignId,
    teamId,
    name: "Gebiet 7",
    geometry: { type: "Polygon", coordinates: [[[7, 50], [7.01, 50], [7.01, 50.01], [7, 50.01], [7, 50]]] },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const canonicalArea = {
    ...oldArea,
    id: "area_canonical_new",
    name: "Gebiet 7 aktuell",
    updatedAt: "2026-09-18T18:22:29.741Z",
  };
  const campaign = {
    id: campaignId,
    campaignId,
    name: "Campaign",
    status: "active",
    defaultMapView: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const team = {
    id: teamId,
    campaignId,
    name: "Team",
    color: "#2563eb",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  let areaBootstrapCalls = 0;
  const issues: string[] = [];
  const snapshots: Array<{ areas: Array<{ id: string }> }> = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
  const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const hostSetInterval = globalThis.setInterval.bind(globalThis);
  const hostClearInterval = globalThis.clearInterval.bind(globalThis);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      setTimeout: hostSetTimeout,
      clearTimeout: hostClearTimeout,
      setInterval: hostSetInterval,
      clearInterval: hostClearInterval,
    },
  });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://flyer.test");
    const parts = url.pathname.split("/");
    const operation = parts.at(-2);
    const collectionName = parts.at(-1);
    if (operation === "pull") {
      let documents: unknown[] = [];
      if (collectionName === "campaigns") documents = [campaign];
      if (collectionName === "teams") documents = [team];
      if (collectionName === "areas") {
        areaBootstrapCalls += 1;
        documents = areaBootstrapCalls === 1 ? [oldArea] : [canonicalArea];
      }
      return Response.json({
        documents,
        checkpoint: { seq: 267 },
        campaignRevision: 20,
      });
    }
    if (operation === "push") {
      return Response.json({ conflicts: [], rejections: [] });
    }
    if (url.pathname.endsWith("/rxdb/checkpoint")) {
      return Response.json({
        checkpoint: { seq: 267 },
        collections: { campaigns: 10, teams: 38, areas: 267, streetTasks: 259, houseTasks: 266 },
        campaignRevision: 20,
      });
    }
    return new Response(null, { status: 404 });
  };

  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: fetchImpl as typeof fetch,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onIssue: (issue) => issues.push(issue.code),
  });

  try {
    await sync.start();
    const collections = (sync as unknown as { collections: Record<string, any> }).collections;
    await waitForCondition(async () => Boolean(await collections.areas.findOne(canonicalArea.id).exec()));
    await waitForCondition(async () => snapshots.some(
      (snapshot) => snapshot.areas.some((area) => area.id === canonicalArea.id),
    ));
    assert.equal(await collections.areas.findOne(oldArea.id).exec(), null);
    assert.ok(areaBootstrapCalls >= 4, "initial bootstrap, mismatch probe, clean bootstrap and verification must all occur");
    assert.ok(!issues.includes("rxdb_canonical_rebootstrap_failed"));
    assert.ok(!issues.includes("rxdb_canonical_area_mismatch"));
  } finally {
    await sync.destroy();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
