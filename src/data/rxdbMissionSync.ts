import { removeRxDatabase } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import type { DurableCampaignMutation } from "../domain/durableMutation.ts";
import { GenerationVisibility } from "./generationVisibility.ts";
import {
  withoutRxdbMetadata,
  type RxdbCollectionName,
  type RxdbDocument,
  type RxdbPushRow,
} from "./rxdbSyncProtocol.ts";
import {
  MissionRxdbSync as MissionRxdbSyncCore,
  RxdbSyncHttpError,
  type RxdbSyncIssue,
} from "./rxdbMissionSyncCore.ts";

export * from "./rxdbMissionSyncCore.ts";

const BARRIER_POLL_INTERVAL_MS = 20;
const AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS = 20_000;
const REBOOTSTRAP_PUSH_TIMEOUT_MS = 20_000;
const PUSH_BATCH_SIZE = 20;
const COLLECTION_NAMES = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const satisfies readonly RxdbCollectionName[];

type PersistenceGateLike = { flush(): void };
type CoreReplicationLike = { cancel(): Promise<unknown> };
type MissionRxdbSyncInput = ConstructorParameters<typeof MissionRxdbSyncCore>[0];
type MissionRxdbSyncInternals = {
  initialized: boolean;
  replicaScope: string;
  collections: Record<RxdbCollectionName, any> | null;
  replications: Map<RxdbCollectionName, CoreReplicationLike>;
  checkpoints: Map<RxdbCollectionName, number>;
  pendingPullProgress: Map<RxdbCollectionName, unknown>;
  pullApplyFailures: Set<RxdbCollectionName>;
  collectionDocuments: Map<RxdbCollectionName, any[]>;
  deletedAreaHints: Map<string, number>;
  pendingPushProofs: Map<string, number>;
  pushProofGeneration: number;
  persistenceGates: Map<RxdbCollectionName, PersistenceGateLike>;
  canonicalRevision: number;
  generationVisibility: GenerationVisibility;
  onIssue: (issue: RxdbSyncIssue) => void;
  request: <T>(operation: "pull" | "push", collectionName: RxdbCollectionName, body: unknown) => Promise<T>;
  createReplication: (collectionName: RxdbCollectionName) => CoreReplicationLike;
};

function safeDatabaseSegment(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function missionDatabaseName(campaignId: string, teamScopeId: string | null, actorScopeId: string | null) {
  const actorSuffix = actorScopeId ? "-actor-" + safeDatabaseSegment(actorScopeId) : "";
  return "verteil-flyer-mission-rxdb-v1-" + campaignId + (teamScopeId ? "-field-group-" + teamScopeId + actorSuffix : "");
}

function replicationDocument(document: RxdbDocument) {
  return { ...document, _deleted: document._deleted === true };
}

/**
 * Public sync coordinator facade.
 *
 * The core owns RxDB replication mechanics. This facade owns refresh ordering:
 * a pull for one collection cannot overtake an already accepted local write in
 * that same collection. Unrelated collections remain independently refreshable.
 *
 * Explicit refreshAndWait() is a global convergence barrier and therefore waits
 * for all already accepted local writes before reading its canonical target.
 *
 * A retained-feed expiry is different from a transient pull failure. Before a
 * clean bootstrap can replace the local replica, every collection is switched
 * to push-only replication with the SAME replicationIdentifier and drained to
 * in-sync. Only then is the local RxDB removed and bootstrapped from canonical
 * server state. This prevents a compacted delete from being resurrected while
 * preserving durable offline writes across browser restarts.
 */
export class MissionRxdbSync extends MissionRxdbSyncCore {
  private readonly automaticRefreshQueued = new Set<RxdbCollectionName>();
  private readonly automaticRefreshBarriers = new Map<RxdbCollectionName, Promise<void>>();
  private readonly recoveryStorage: any;
  private readonly recoveryDatabaseName: string;
  private readonly recoveryProgressKey: string;
  private readonly recoveryReplicationPrefix: string;
  private recoveryPromise: Promise<void> | null = null;

  constructor(input: MissionRxdbSyncInput) {
    const storage = input.storage ?? getRxStorageDexie();
    let instance: MissionRxdbSync | null = null;
    const userOnIssue = input.onIssue;
    super({
      ...input,
      storage,
      onIssue: (issue) => {
        userOnIssue(issue);
        if (issue.operation === "pull" && issue.collectionName && issue.code === "rxdb_checkpoint_expired") {
          void Promise.resolve().then(() => instance?.scheduleExpiredCheckpointRecovery(issue.collectionName!));
        }
      },
    });
    instance = this;
    this.recoveryStorage = storage;
    const teamScopeId = input.teamScopeId ?? null;
    const actorScopeId = input.actorScopeId ?? null;
    const replicaScope = actorScopeId
      ? "field-group:" + (teamScopeId ?? "unscoped") + ":" + actorScopeId
      : teamScopeId
        ? "team:" + teamScopeId
        : "campaign";
    this.recoveryDatabaseName = missionDatabaseName(input.campaignId, teamScopeId, actorScopeId);
    this.recoveryProgressKey = "verteil-flyer:rxdb-progress:v1:" + encodeURIComponent(input.campaignId) + ":" + encodeURIComponent(replicaScope);
    this.recoveryReplicationPrefix = "mission-rxdb-sync-v1:" + input.campaignId + ":" + replicaScope + ":";
  }

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
    if (this.automaticRefreshBarriers.has(collectionName) || this.recoveryPromise) return;
    const state = this.internals();
    const deadline = Date.now() + AUTOMATIC_REFRESH_BARRIER_TIMEOUT_MS;
    const barrier = this.waitForPendingPushes([collectionName], deadline)
      .then(() => {
        if (!state.initialized || this.recoveryPromise || !this.automaticRefreshQueued.has(collectionName)) return;
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
        if (state.initialized && !this.recoveryPromise && this.automaticRefreshQueued.has(collectionName)) {
          this.scheduleAutomaticRefresh(collectionName);
        }
      });
    this.automaticRefreshBarriers.set(collectionName, barrier);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = globalThis.setTimeout(() => reject(new RxdbSyncHttpError(0, code, "RxDB-Wiederherstellung konnte nicht rechtzeitig abgeschlossen werden.")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== null) globalThis.clearTimeout(timer);
    }
  }

  private createPushDrain(collectionName: RxdbCollectionName) {
    const state = this.internals();
    const collection = state.collections?.[collectionName];
    if (!collection) throw new RxdbSyncHttpError(0, "rxdb_collection_missing", "RxDB-Datenbereich ist für die Wiederherstellung nicht verfügbar.");
    return replicateRxCollection<RxdbDocument, { seq: number }>({
      replicationIdentifier: this.recoveryReplicationPrefix + collectionName,
      collection,
      push: {
        batchSize: PUSH_BATCH_SIZE,
        handler: async (rows: RxdbPushRow[]) => {
          const result = await state.request<{ conflicts: RxdbDocument[]; rejections: Array<{ documentId: string; code: string }> }>("push", collectionName, {
            rows: rows.map((row) => ({
              ...(row.assumedMasterState ? { assumedMasterState: withoutRxdbMetadata(row.assumedMasterState) } : {}),
              newDocumentState: withoutRxdbMetadata(row.newDocumentState),
            })),
          });
          for (const rejection of result.rejections) {
            state.onIssue({ kind: "rejected", collectionName, documentId: rejection.documentId, code: rejection.code });
          }
          return result.conflicts.map(replicationDocument);
        },
      },
      live: true,
      retryTime: 2_000,
      waitForLeadership: false,
    });
  }

  private clearLocalProgressForBootstrap() {
    const state = this.internals();
    state.checkpoints.clear();
    state.pendingPullProgress.clear();
    state.pullApplyFailures.clear();
    state.collectionDocuments.clear();
    state.deletedAreaHints.clear();
    state.pendingPushProofs.clear();
    state.pushProofGeneration = 0;
    state.canonicalRevision = 0;
    state.generationVisibility = new GenerationVisibility();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(this.recoveryProgressKey);
        window.localStorage.removeItem(this.recoveryProgressKey + ":generations");
      } catch {
      }
    }
  }

  private async restoreCombinedReplications() {
    const state = this.internals();
    if (!state.initialized || !state.collections) return;
    for (const collectionName of COLLECTION_NAMES) {
      try {
        state.createReplication(collectionName);
      } catch {
      }
    }
  }

  private async recoverExpiredCheckpoint(_collectionName: RxdbCollectionName) {
    const state = this.internals();
    if (!state.initialized || !state.collections) return;
    this.automaticRefreshQueued.clear();
    this.flushPersistenceGates(COLLECTION_NAMES);

    const drains: any[] = [];
    let destroyed = false;
    try {
      await Promise.all([...state.replications.values()].map((replication) => replication.cancel()));
      for (const name of COLLECTION_NAMES) drains.push(this.createPushDrain(name));
      await Promise.all(drains.map((drain) => this.withTimeout(drain.awaitInSync(), REBOOTSTRAP_PUSH_TIMEOUT_MS, "rxdb_rebootstrap_push_timeout")));
      await Promise.all(drains.map((drain) => drain.cancel()));
      await super.destroy();
      destroyed = true;
      await removeRxDatabase(this.recoveryDatabaseName, this.recoveryStorage);
      this.clearLocalProgressForBootstrap();
      await super.start();
    } catch (error) {
      await Promise.all(drains.map((drain) => drain.cancel().catch(() => undefined)));
      if (destroyed) {
        try { await super.start(); } catch {}
      } else {
        await this.restoreCombinedReplications();
      }
      throw error;
    }

    if (!state.initialized) {
      throw new RxdbSyncHttpError(0, "rxdb_rebootstrap_failed", "RxDB-Wiederherstellung wurde nicht vollständig neu gestartet.");
    }
  }

  private scheduleExpiredCheckpointRecovery(collectionName: RxdbCollectionName) {
    if (this.recoveryPromise) return;
    const state = this.internals();
    const recovery = this.recoverExpiredCheckpoint(collectionName);
    this.recoveryPromise = recovery;
    void recovery
      .catch((error: unknown) => {
        state.onIssue({
          kind: "network",
          collectionName,
          operation: "pull",
          code: error instanceof RxdbSyncHttpError ? error.code : "rxdb_rebootstrap_failed",
        });
      })
      .finally(() => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = null;
      });
  }

  override refresh(names: readonly RxdbCollectionName[] = COLLECTION_NAMES) {
    if (this.recoveryPromise) return;
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
    if (this.recoveryPromise) {
      await this.withTimeout(this.recoveryPromise, Math.max(1, deadline - Date.now()), "rxdb_refresh_timeout");
    }
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

  override async applyMutation(mutation: DurableCampaignMutation) {
    if (this.recoveryPromise) await this.recoveryPromise;
    return await super.applyMutation(mutation);
  }
}
