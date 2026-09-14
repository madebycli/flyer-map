import {
  MissionRxdbSync as MissionRxdbSyncCore,
  RxdbSyncHttpError,
  type RxdbSyncIssue,
} from "./rxdbMissionSyncCore.ts";
import type { RxdbCollectionName } from "./rxdbSyncProtocol.ts";

export * from "./rxdbMissionSyncCore.ts";

const BARRIER_POLL_INTERVAL_MS = 20;
const AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS = 20_000;
const COLLECTION_NAMES = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];

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
 * a pull for one collection cannot overtake an already accepted local write in
 * that same collection. Unrelated collections remain independently refreshable.
 *
 * Explicit refreshAndWait() is a global convergence barrier and therefore waits
 * for all already accepted local writes before reading its canonical target.
 */
export class MissionRxdbSync extends MissionRxdbSyncCore {
  private readonly automaticRefreshQueued = new Set<RxdbCollectionName>();
  private readonly automaticRefreshBarriers = new Map<RxdbCollectionName, Promise<void>>();

  private internals() {
    return this as unknown as MissionRxdbSyncInternals;
  }

  private flushPersistenceGates(names: readonly RxdbCollectionName[]) {
    const gates = this.internals().persistenceGates;
    for (const name of names) gates.get(name)?.flush();
  }

  private hasPendingPush(collectionName: RxdbCollectionName) {
    const prefix = collectionName + ":";
    for (const proofKey of this.internals().pendingPushProofs.keys()) {
      if (proofKey.startsWith(prefix)) return true;
    }
    return false;
  }

  private async waitForPendingPushes(names: readonly RxdbCollectionName[], deadline: number) {
    this.flushPersistenceGates(names);
    while (names.some((name) => this.hasPendingPush(name))) {
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

  private scheduleAutomaticRefresh(collectionName: RxdbCollectionName) {
    if (this.automaticRefreshBarriers.has(collectionName)) return;
    const state = this.internals();
    const deadline = Date.now() + AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS;
    const barrier = this.waitForPendingPushes([collectionName], deadline)
      .then(() => {
        if (!state.initialized || !this.automaticRefreshQueued.has(collectionName)) return;
        this.automaticRefreshQueued.delete(collectionName);
        super.refresh([collectionName]);
      })
      .catch((error: unknown) => {
        this.automaticRefreshQueued.delete(collectionName);
        state.onIssue({
          kind: "network",
          collectionName,
          operation: "push",
          code: error instanceof RxdbSyncHttpError ? error.code : "rxdb_refresh_barrier_failed",
        });
      })
      .finally(() => {
        this.automaticRefreshBarriers.delete(collectionName);
        if (state.initialized && this.automaticRefreshQueued.has(collectionName)) {
          this.scheduleAutomaticRefresh(collectionName);
        }
      });
    this.automaticRefreshBarriers.set(collectionName, barrier);
  }

  override refresh(names: readonly RxdbCollectionName[] = COLLECTION_NAMES) {
    const requestedNames = [...new Set(names)];
    this.flushPersistenceGates(requestedNames);

    const ready: RxdbCollectionName[] = [];
    for (const name of requestedNames) {
      if (!this.hasPendingPush(name)) {
        this.automaticRefreshQueued.delete(name);
        ready.push(name);
        continue;
      }
      this.automaticRefreshQueued.add(name);
      this.scheduleAutomaticRefresh(name);
    }

    if (ready.length > 0) super.refresh(ready);
  }

  override async refreshAndWait(timeoutMs = 15_000) {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    await this.waitForPendingPushes(COLLECTION_NAMES, deadline);
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
