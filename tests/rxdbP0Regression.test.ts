import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmCampaignSession,
  type AccessInfo,
  CampaignApiError,
} from "../src/data/campaignApi.ts";
import {
  describeRxdbSyncError,
  MissionRxdbSync,
  type RxdbSyncIssue,
} from "../src/data/rxdbMissionSync.ts";
import {
  syncIssueAffectedLabel,
  type SyncIssue,
} from "../src/data/campaignStore.ts";
import type { RxdbCollectionName } from "../src/data/rxdbSyncProtocol.ts";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

const collectionNames = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];

async function waitForCondition(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition_timeout");
}

test("RxDB keeps the nested Worker failure instead of the RC_PULL wrapper", () => {
  const details = describeRxdbSyncError({
    code: "RC_PULL",
    parameters: {
      direction: "pull",
      errors: [{ name: "RxdbSyncHttpError", status: 401, code: "access_required", message: "access required" }],
    },
  });

  assert.deepEqual(details, { direction: "pull", code: "access_required", status: 401 });
});

test("sync status reports one, multiple, and global RxDB failures truthfully", () => {
  const one = {
    kind: "network",
    scope: "collection",
    affectedCollections: ["streetTasks"],
    message: "offline",
  } satisfies SyncIssue;
  const multiple = {
    kind: "network",
    scope: "multiple",
    affectedCollections: ["campaigns", "teams", "houseTasks"],
    message: "offline",
  } satisfies SyncIssue;
  const server = {
    kind: "network",
    scope: "server",
    message: "offline",
  } satisfies SyncIssue;

  assert.equal(syncIssueAffectedLabel(one), "Betroffen: streetTasks");
  assert.equal(syncIssueAffectedLabel(multiple), "Betroffen: mehrere Datenbereiche (campaigns, teams, houseTasks)");
  assert.equal(syncIssueAffectedLabel(server), "Betroffen: gemeinsamer Serverstand");
});

test("created or redeemed session is confirmed before RxDB startup", async () => {
  const previousFetch = globalThis.fetch;
  const access: AccessInfo = {
    campaignId: "campaign_session_handoff",
    role: "admin",
    teamId: null,
    label: "Initial admin",
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) return Response.json({ error: { code: "access_required", message: "not ready" } }, { status: 401 });
    return Response.json({ access });
  };

  try {
    assert.deepEqual(await confirmCampaignSession(access.campaignId), access);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fresh startup starts all five pulls and recovers a transient collection auth response", async () => {
  const campaignId = `campaign_startup_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    },
  });
  const requests: RxdbCollectionName[] = [];
  const issues: RxdbSyncIssue[] = [];
  const resolved: RxdbCollectionName[] = [];
  let housePullAttempts = 0;
  const sync = new MissionRxdbSync({
    campaignId,
    storage: getRxStorageMemory(),
    multiInstance: false,
    fetchImpl: async (input) => {
      const url = new URL(String(input), "https://flyer.test");
      const operation = url.pathname.split("/").at(-2);
      const collectionName = url.pathname.split("/").at(-1);
      if (operation !== "pull" || !collectionNames.includes(collectionName as RxdbCollectionName)) return new Response(null, { status: 404 });
      const collection = collectionName as RxdbCollectionName;
      requests.push(collection);
      if (collection === "houseTasks" && housePullAttempts++ === 0) {
        return Response.json({ error: { code: "access_required", message: "access required" } }, { status: 401 });
      }
      return Response.json({ documents: [], checkpoint: { seq: 0 }, campaignRevision: 0 });
    },
    onSnapshot: () => undefined,
    onIssue: (issue) => issues.push(issue),
    onIssueResolved: (collectionName) => { if (collectionName) resolved.push(collectionName); },
  });

  try {
    await sync.start();
    await waitForCondition(() => housePullAttempts >= 2);
    await waitForCondition(() => collectionNames.every((collectionName) => requests.includes(collectionName)));
    assert.ok(issues.some((issue) => issue.collectionName === "houseTasks" && issue.code === "access_required" && issue.operation === "pull"));
    assert.ok(resolved.includes("houseTasks"), "a successful retry must resolve the collection issue");
  } finally {
    await sync.destroy();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("session confirmation does not retry unrelated server failures", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: { code: "internal_error", message: "broken" } }, { status: 500 });
  };

  try {
    await assert.rejects(
      () => confirmCampaignSession("campaign_session_error"),
      (error: unknown) => error instanceof CampaignApiError && error.status === 500 && error.code === "internal_error",
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
