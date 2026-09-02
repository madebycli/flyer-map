import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_PREPARATION_POLL_INTERVAL_MS,
  AREA_PREPARATION_NOT_YET_PERSISTED_RETRY_LIMIT,
  AREA_PREPARATION_STALE_PENDING_MS,
  createAreaPreparationPoller,
} from "../src/areaPreparation/preparationPolling.ts";
import {
  CampaignApiError,
  type AreaPreparationPublicState,
} from "../src/data/campaignApi.ts";

const pending: AreaPreparationPublicState = {
  status: "pending",
  roadCount: 0,
  houseCount: 0,
  sourceTimestamp: null,
  errorCode: null,
  updatedAt: null,
};

const ready: AreaPreparationPublicState = {
  status: "ready",
  roadCount: 42,
  houseCount: 186,
  sourceTimestamp: "2026-09-01T10:00:00.000Z",
  errorCode: null,
  updatedAt: "2026-09-01T10:01:00.000Z",
};

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function timerQueue() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    scheduler: {
      setTimeout(callback: () => void, delayMs: number) {
        const id = nextId++;
        delays.push(delayMs);
        callbacks.set(id, callback);
        return id;
      },
      clearTimeout(timeoutId: number) {
        callbacks.delete(timeoutId);
      },
    },
    delays,
    get size() {
      return callbacks.size;
    },
    runNext() {
      const entry = callbacks.entries().next().value as [number, () => void] | undefined;
      assert.ok(entry, "a pending poll timer is expected");
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
}

test("missing preparation starts once, polls every two seconds, and refreshes once on ready", async () => {
  const timers = timerQueue();
  const fetched: AreaPreparationPublicState[] = [
    { ...pending, status: "missing" },
    pending,
    ready,
  ];
  const states: string[] = [];
  let fetchCalls = 0;
  let startCalls = 0;
  let pendingMarked = false;
  let refreshes = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        fetchCalls += 1;
        return fetched.shift()!;
      },
      async start() {
        startCalls += 1;
        return pending;
      },
    },
    canAutoStart: () => startCalls === 0,
    markAutoStarted() {},
    markPending() {
      pendingMarked = true;
    },
    hasPending: () => pendingMarked,
    clearPending() {
      pendingMarked = false;
    },
    onState: (state) => states.push(state.status),
    onReady: () => {
      refreshes += 1;
    },
    onError: (error) => {
      throw error;
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(fetchCalls, 1);
  assert.equal(startCalls, 1);
  assert.deepEqual(states, ["pending", "pending"]);
  assert.equal(timers.size, 1);
  assert.deepEqual(timers.delays, [AREA_PREPARATION_POLL_INTERVAL_MS]);

  timers.runNext();
  await settle();
  assert.equal(fetchCalls, 2);
  assert.equal(timers.size, 1);

  timers.runNext();
  await settle();
  assert.equal(fetchCalls, 3);
  assert.deepEqual(states, ["pending", "pending", "pending", "ready"]);
  assert.equal(refreshes, 1);
  assert.equal(timers.size, 0);
});

test("failed preparation is automatically restarted once when the Area Sheet opens", async () => {
  const timers = timerQueue();
  const states: string[] = [];
  let startCalls = 0;
  let autoStarts = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        return {
          ...pending,
          status: "failed",
          errorCode: "area_preparation_osm_failed",
          updatedAt: "2026-09-01T20:00:00.000Z",
        };
      },
      async start() {
        startCalls += 1;
        return { ...pending, updatedAt: "2026-09-02T00:00:00.000Z" };
      },
    },
    canAutoStart: () => autoStarts === 0,
    markAutoStarted: () => {
      autoStarts += 1;
    },
    markPending() {},
    hasPending: () => true,
    clearPending() {},
    onState: (state) => states.push(state.status),
    onReady() {},
    onError(error) {
      throw error;
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(startCalls, 1);
  assert.equal(autoStarts, 1);
  assert.deepEqual(states, ["pending", "pending"]);
  assert.equal(timers.size, 1);
});

test("stale pending preparation is automatically reclaimed once, while fresh pending keeps polling", async () => {
  const timers = timerQueue();
  let startCalls = 0;
  let autoStarts = 0;
  const staleUpdatedAt = new Date(Date.now() - AREA_PREPARATION_STALE_PENDING_MS - 1_000).toISOString();
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        return { ...pending, updatedAt: staleUpdatedAt };
      },
      async start() {
        startCalls += 1;
        return { ...pending, updatedAt: new Date().toISOString() };
      },
    },
    canAutoStart: () => autoStarts === 0,
    markAutoStarted: () => {
      autoStarts += 1;
    },
    markPending() {},
    hasPending: () => true,
    clearPending() {},
    onState() {},
    onReady() {},
    onError(error) {
      throw error;
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(startCalls, 1);
  assert.equal(autoStarts, 1);
  assert.equal(timers.size, 1);
});

test("a just-created Area can propagate after the first 404 before auto-start", async () => {
  const timers = timerQueue();
  const states: string[] = [];
  let fetchCalls = 0;
  let startCalls = 0;
  let pendingMarks = 0;
  let autoStarts = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        fetchCalls += 1;
        if (fetchCalls < 3) {
          throw new CampaignApiError(404, "area_not_found", "Area wurde noch nicht synchronisiert.");
        }
        return { ...pending, status: "missing" };
      },
      async start() {
        startCalls += 1;
        return pending;
      },
    },
    canAutoStart: () => true,
    markAutoStarted: () => {
      autoStarts += 1;
    },
    markPending: () => {
      pendingMarks += 1;
    },
    hasPending: () => pendingMarks > 0,
    clearPending: () => {
      pendingMarks = 0;
    },
    onState: (state) => states.push(state.status),
    onReady: () => {},
    onError: (error) => {
      throw error;
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(fetchCalls, 1);
  assert.equal(startCalls, 0);
  assert.equal(timers.size, 1);

  timers.runNext();
  await settle();
  assert.equal(fetchCalls, 2);
  assert.equal(startCalls, 0);
  assert.equal(timers.size, 1);

  timers.runNext();
  await settle();
  assert.equal(fetchCalls, 3);
  assert.equal(startCalls, 1);
  assert.equal(autoStarts, 1);
  assert.deepEqual(states, ["pending", "pending", "pending", "pending"]);
  assert.equal(timers.size, 1);
});

test("not-yet-persisted Area retries stop after a bounded budget", async () => {
  const timers = timerQueue();
  const failures: unknown[] = [];
  let fetchCalls = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        fetchCalls += 1;
        throw new CampaignApiError(404, "area_not_found", "Area wurde noch nicht synchronisiert.");
      },
      async start() {
        throw new Error("start must not be reached");
      },
    },
    canAutoStart: () => true,
    markAutoStarted: () => {},
    markPending: () => {},
    hasPending: () => true,
    clearPending: () => {},
    onState: () => {},
    onReady: () => {},
    onError: (error) => failures.push(error),
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  for (let retry = 0; retry < AREA_PREPARATION_NOT_YET_PERSISTED_RETRY_LIMIT; retry += 1) {
    assert.equal(timers.size, 1);
    timers.runNext();
    await settle();
  }

  assert.equal(fetchCalls, AREA_PREPARATION_NOT_YET_PERSISTED_RETRY_LIMIT + 1);
  assert.equal(failures.length, 1);
  assert.equal(timers.size, 0);
});

test("closing the Area Sheet stops a pending preparation poll", async () => {
  const timers = timerQueue();
  let fetchCalls = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        fetchCalls += 1;
        return pending;
      },
      async start() {
        return pending;
      },
    },
    canAutoStart: () => true,
    markAutoStarted() {},
    markPending() {},
    hasPending: () => true,
    clearPending() {},
    onState() {},
    onReady() {},
    onError(error) {
      throw error;
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(timers.size, 1);
  poller.stop();
  assert.equal(timers.size, 0);
  assert.equal(fetchCalls, 1);
});

test("failed and schema-unavailable responses do not create a retry loop", async () => {
  const timers = timerQueue();
  const failures: unknown[] = [];
  let startCalls = 0;
  const poller = createAreaPreparationPoller({
    campaignId: "campaign-1",
    areaId: "area-1",
    client: {
      async fetchState() {
        throw new Error("area_preparation_schema_unavailable");
      },
      async start() {
        startCalls += 1;
        return { ...pending, status: "failed", errorCode: "upstream" };
      },
    },
    canAutoStart: () => true,
    markAutoStarted() {},
    markPending() {},
    hasPending: () => false,
    clearPending() {},
    onState() {},
    onReady() {},
    onError(error) {
      failures.push(error);
    },
    scheduler: timers.scheduler,
  });

  poller.start();
  await settle();
  assert.equal(failures.length, 1);
  assert.equal(timers.size, 0);

  poller.retry();
  await settle();
  assert.equal(startCalls, 1);
  assert.equal(timers.size, 0);
});
