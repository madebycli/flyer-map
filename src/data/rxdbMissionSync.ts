import {
  MissionRxdbSync as MissionRxdbSyncCore,
  RxdbSyncHttpError,
  type RxdbSyncIssue,
} from "./rxdbMissionSyncCore.ts";
import type { RxdbCollectionName } from "./rxdbSyncProtocol.ts";

export * from "./rxdbMissionSyncCore.ts";

const BARRIER_POLL_INTERVAL_MS = 20;
const AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS = 20_000;

type PersistenceGateLike = { flush(): void };
type MissionRxdbSyncInternals = {
  initialized: boolean;
  pendingPushProofs: Map<string, number>;
  persistenceGates: Map<RxdbCollectionName, PersistenceGateLike>;
  onIssue: (issue: RxdbSyncIssue) => void;
};

/**
 * Public sync coordinator facade.
 *
 * The core owns RxDB replication mechanics. This facade owns refresh ordering:
 * no explicit, realtime, reconnect or visibility-triggered refresh may start
 * while a locally accepted write is still waiting for its push proof.
 *
 * This deliberately uses a conservative all-pending barrier. A generation
 * watermark becomes safe only together with an explicit rebase layer for writes
 * accepted after a closed round.
 */
export class MissionRxdbSync extends MissionRxdbSyncCore {
  private automaticRefreshNames = new Set<RxdbCollectionName>();
  private automaticRefreshBarrier: Promise<void> | null = null;

  private internals() {
    return this as unknown as MissionRxdbSyncInternals;
  }

  private flushPersistenceGates() {
    for (const gate of this.internals().persistenceGates.values()) gate.flush();
  }

  private async waitForPendingPushes(deadline: number) {
    this.flushPersistenceGates();
    const state = this.internals();
    while (state.pendingPushProofs.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new RxdbSyncHttpError(
          0,
          "rxdb_refresh_timeout",
          "Lokale Änderungen konnten vor der Aktualisierung nicht rechtzeitig bestätigt werden.",
        );
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, Math.min(BARRIER_POLL_INTERVAL_MS, remaining)));
    }
  }

  override refresh(names?: readonly RxdbCollectionName[]) {
    const requestedNames = names ?? (["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const);
    this.flushPersistenceGates();
    const state = this.internals();
    if (state.pendingPushProofs.size === 0) {
      super.refresh(requestedNames);
      return;
    }

    for (const name of requestedNames) this.automaticRefreshNames.add(name);
    if (this.automaticRefreshBarrier) return;

    const deadline = Date.now() + AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS;
    this.automaticRefreshBarrier = this.waitForPendingPushes(deadline)
      .then(() => {
        if (!state.initialized) return;
        const queued = [...this.automaticRefreshNames];
        this.automaticRefreshNames.clear();
        if (queued.length > 0) super.refresh(queued);
      })
      .catch((error: unknown) => {
        state.onIssue({
          kind: "network",
          operation: "push",
          code: error instanceof RxdbSyncHttpError ? error.code : "rxdb_refresh_barrier_failed",
        });
      })
      .finally(() => {
        this.automaticRefreshBarrier = null;
        if (this.automaticRefreshNames.size > 0 && state.initialized) this.refresh([...this.automaticRefreshNames]);
      });
  }

  override async refreshAndWait(timeoutMs = 15_000) {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    await this.waitForPendingPushes(deadline);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RxdbSyncHttpError(
        0,
        "rxdb_refresh_timeout",
        "Lokale Änderungen konnten vor der Aktualisierung nicht rechtzeitig bestätigt werden.",
      );
    }
    return await super.refreshAndWait(remaining);
  }
}
