import type { AreaPreparationPublicState } from "../data/campaignApi";

export const AREA_PREPARATION_POLL_INTERVAL_MS = 2_000;

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

/**
 * Owns one open Area Sheet's short-lived preparation read/poll/retry cycle.
 * It deliberately never retries a failed request on its own.
 */
export function createAreaPreparationPoller(
  options: AreaPreparationPollerOptions,
): AreaPreparationPoller {
  const scheduler = options.scheduler ?? browserScheduler();
  let stopped = false;
  let inFlight = false;
  let pollTimeout: number | null = null;

  const clearPoll = () => {
    if (pollTimeout === null) return;
    scheduler.clearTimeout(pollTimeout);
    pollTimeout = null;
  };

  const schedulePoll = () => {
    clearPoll();
    pollTimeout = scheduler.setTimeout(() => {
      pollTimeout = null;
      void load(false);
    }, AREA_PREPARATION_POLL_INTERVAL_MS);
  };

  const applyState = (state: AreaPreparationPublicState) => {
    if (stopped) return;
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
      let state = await options.client.fetchState(options.campaignId, options.areaId);
      if (stopped) return;
      if (state.status === "missing" && allowAutoStart && options.canAutoStart()) {
        options.markAutoStarted();
        await runStart();
        return;
      }
      applyState(state);
    } catch (error) {
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
