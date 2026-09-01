import {
  CampaignApiError,
  type AreaPreparationPublicState,
} from "../data/campaignApi.ts";

export const AREA_PREPARATION_POLL_INTERVAL_MS = 2_000;
export const AREA_PREPARATION_NOT_YET_PERSISTED_RETRY_LIMIT = 5;
export const AREA_PREPARATION_STALE_PENDING_MS = 60_000;

export type AreaPreparationClient = {
  fetchState(campaignId: string, areaId: string): Promise<AreaPreparationPublicState>;
  start(campaignId: string, areaId: string): Promise<AreaPreparationPublicState>;
};

type Scheduler = {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number): void;
};

export type AreaPreparationPoller = {
  start(): void;
  retry(): void;
  stop(): void;
};

type AreaPreparationPollerOptions = {
  campaignId: string;
  areaId: string;
  client: AreaPreparationClient;
  canAutoStart(): boolean;
  markAutoStarted(): void;
  markPending(): void;
  hasPending(): boolean;
  clearPending(): void;
  onState(state: AreaPreparationPublicState): void;
  onReady(): void;
  onError(error: unknown): void;
  scheduler?: Scheduler;
};

function pendingState(): AreaPreparationPublicState {
  return {
    status: "pending",
    roadCount: 0,
    houseCount: 0,
    sourceTimestamp: null,
    errorCode: null,
    updatedAt: null,
  };
}

function browserScheduler(): Scheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

function isAreaNotYetPersistedError(error: unknown) {
  return error instanceof CampaignApiError && error.status === 404 && error.code === "area_not_found";
}

function isStalePending(state: AreaPreparationPublicState) {
  if (state.status !== "pending" || !state.updatedAt) return false;
  const updatedAt = Date.parse(state.updatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt >= AREA_PREPARATION_STALE_PENDING_MS;
}

function shouldAutoRecover(state: AreaPreparationPublicState) {
  return state.status === "missing" || state.status === "failed" || isStalePending(state);
}

/**
 * Owns one open Area Sheet's short-lived preparation read/poll/retry cycle.
 * A missing, failed, or stale pending preparation is recovered once per Area
 * Sheet session through canAutoStart/markAutoStarted. Fresh pending work keeps
 * polling, and other request errors still require an explicit user retry.
 */
export function createAreaPreparationPoller(
  options: AreaPreparationPollerOptions,
): AreaPreparationPoller {
  const scheduler = options.scheduler ?? browserScheduler();
  let stopped = false;
  let inFlight = false;
  let pollTimeout: number | null = null;
  let notYetPersistedRetryCount = 0;

  const clearPoll = () => {
    if (pollTimeout === null) return;
    scheduler.clearTimeout(pollTimeout);
    pollTimeout = null;
  };

  const schedulePoll = (allowAutoStart = false) => {
    clearPoll();
    pollTimeout = scheduler.setTimeout(() => {
      pollTimeout = null;
      void load(allowAutoStart);
    }, AREA_PREPARATION_POLL_INTERVAL_MS);
  };

  const applyState = (state: AreaPreparationPublicState) => {
    if (stopped) return;
    notYetPersistedRetryCount = 0;
    options.onState(state);
    if (state.status === "pending") {
      options.markPending();
      schedulePoll();
      return;
    }
    clearPoll();
    if (state.status === "ready" && options.hasPending()) {
      options.clearPending();
      options.onReady();
    }
  };

  const runStart = async () => {
    options.markPending();
    options.onState(pendingState());
    const state = await options.client.start(options.campaignId, options.areaId);
    applyState(state);
  };

  const load = async (allowAutoStart: boolean) => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const state = await options.client.fetchState(options.campaignId, options.areaId);
      if (stopped) return;
      if (allowAutoStart && shouldAutoRecover(state) && options.canAutoStart()) {
        options.markAutoStarted();
        await runStart();
        return;
      }
      applyState(state);
    } catch (error) {
      if (
        !stopped &&
        allowAutoStart &&
        isAreaNotYetPersistedError(error) &&
        notYetPersistedRetryCount < AREA_PREPARATION_NOT_YET_PERSISTED_RETRY_LIMIT
      ) {
        notYetPersistedRetryCount += 1;
        options.markPending();
        options.onState(pendingState());
        schedulePoll(true);
        return;
      }
      if (!stopped) options.onError(error);
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      void load(true);
    },
    retry() {
      if (stopped || inFlight) return;
      clearPoll();
      notYetPersistedRetryCount = 0;
      inFlight = true;
      void runStart()
        .catch((error) => {
          if (!stopped) options.onError(error);
        })
        .finally(() => {
          inFlight = false;
        });
    },
    stop() {
      stopped = true;
      clearPoll();
    },
  };
}
