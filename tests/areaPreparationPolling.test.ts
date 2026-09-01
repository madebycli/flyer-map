import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_PREPARATION_POLL_INTERVAL_MS,
  createAreaPreparationPoller,
} from "../src/areaPreparation/preparationPolling.ts";
import type { AreaPreparationPublicState } from "../src/data/campaignApi.ts";

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
