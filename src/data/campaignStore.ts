import {
  CampaignApiError,
  accessTokenFromUrl,
  buildCampaignAccessUrl,
  collectionAccessTokenFromUrl,
  collectionModeFromUrl,
  fetchCollectionSnapshot,
  fetchCurrentCollectionAccess,
  redeemCollectionAccess,
  removeCollectionAccessTokenFromUrl,
  campaignIdFromUrl,
  createCampaignSnapshot,
  fetchCampaignSnapshot,
  fetchCampaignVersion,
  fetchCurrentAccess,
  postCampaignMutation,
  putCampaignSnapshot,
  redeemCampaignAccess,
  removeAccessTokenFromUrl,
  setCampaignIdInUrl,
  type AccessInfo,
} from "./campaignApi";
import {
  browserMutationQueue,
  type QueuedCampaignMutation,
} from "./mutationQueue";
import {
  createInitialSnapshot,
  type Area,
  type Campaign,
  type CampaignSnapshot,
  type DistributionTask,
  type LineStringGeometry,
  type MapCameraView,
  type PolygonGeometry,
  type Team,
} from "../domain/campaign";
import {
  deriveCampaignMutation,
  MutationDerivationError,
} from "../domain/mutationDiff";

const STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const BACKUP_STORAGE_KEY = "verteil-flyer:campaign-snapshot:backup";
const CONFLICT_STORAGE_KEY = "verteil-flyer:campaign-snapshot:conflict";
const LEGACY_STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";
const POLL_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type CampaignLoadResult = { snapshot: CampaignSnapshot; warning: string | null };
export type RefreshState = "idle" | "loading" | "current" | "error" | "available";
export type SyncMessageCode = "access_required" | "network" | "conflict" | "forbidden" | "schema_migration_required" | null;
export type MutationSyncState =
  | "saved"
  | "pending"
  | "syncing"
  | "offline"
  | "conflict"
  | "failed"
  | "blocked-auth";
export type CampaignStoreUpdate = {
  snapshot?: CampaignSnapshot;
  access?: AccessInfo | null;
  refreshState?: RefreshState;
  messageCode?: SyncMessageCode;
  initialAccessUrl?: string;
  syncState?: MutationSyncState;
  pendingCount?: number;
};

type LegacyCampaign = Omit<Campaign, "defaultMapView">;
type SnapshotV2 = Omit<CampaignSnapshot, "schemaVersion" | "campaign"> & {
  schemaVersion: 2;
  campaign: LegacyCampaign;
};
type SnapshotV1 = Omit<SnapshotV2, "schemaVersion" | "tasks"> & {
  schemaVersion: 1;
};
type SyncRuntime = {
  targetCampaignId: string | null;
  latestLocal: CampaignSnapshot | null;
  lastServer: CampaignSnapshot | null;
  serverRevision: number | null;
  remoteRevision: number | null;
  access: AccessInfo | null;
  initialized: boolean;
  initializeInFlight: boolean;
  queueInFlight: boolean;
  listenersStarted: boolean;
  interactionBlocked: boolean;
  needsCanonicalRefresh: boolean;
  retryTimer: number | null;
  enqueuesPending: number;
};

const syncRuntime: SyncRuntime = {
  targetCampaignId: null,
  latestLocal: null,
  lastServer: null,
  serverRevision: null,
  remoteRevision: null,
  access: null,
  initialized: false,
  initializeInFlight: false,
  queueInFlight: false,
  listenersStarted: false,
  interactionBlocked: false,
  needsCanonicalRefresh: false,
  retryTimer: null,
  enqueuesPending: 0,
};

const listeners = new Set<(update: CampaignStoreUpdate) => void>();
let loadedExistingSnapshot = false;
let refreshResetTimer: number | null = null;
let enqueueChain: Promise<void> = Promise.resolve();

function emit(update: CampaignStoreUpdate) {
  for (const listener of listeners) listener(update);
}

function setRefreshState(state: RefreshState, reset = false) {
  emit({ refreshState: state });
  if (typeof window === "undefined") return;
  if (refreshResetTimer !== null) window.clearTimeout(refreshResetTimer);
  if (reset) {
    refreshResetTimer = window.setTimeout(() => emit({ refreshState: "idle" }), 1800);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLngLat(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isMapCameraView(value: unknown): value is MapCameraView {
  return (
    isRecord(value) &&
    isLngLat(value.center) &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    typeof value.bearing === "number" &&
    Number.isFinite(value.bearing)
  );
}

function isPolygonGeometry(value: unknown): value is PolygonGeometry {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    return false;
  }
  const firstRing = value.coordinates[0];
  return Array.isArray(firstRing) && firstRing.every(isLngLat);
}

function isLineStringGeometry(value: unknown): value is LineStringGeometry {
  return (
    isRecord(value) &&
    value.type === "LineString" &&
    Array.isArray(value.coordinates) &&
    value.coordinates.every(isLngLat)
  );
}

function isTeam(value: unknown): value is Team {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.name === "string" &&
    typeof value.color === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isArea(value: unknown): value is Area {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.teamId === "string" &&
    typeof value.name === "string" &&
    isPolygonGeometry(value.geometry) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isDistributionTask(value: unknown): value is DistributionTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.areaId === "string" &&
    value.taskType === "street" &&
    typeof value.label === "string" &&
    isLineStringGeometry(value.geometry) &&
    (value.status === "open" ||
      value.status === "completed" ||
      value.status === "later" ||
      value.status === "not-deliverable") &&
    (value.completedAt === null || typeof value.completedAt === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function hasValidCampaign(value: Record<string, unknown>, requireMapView: boolean) {
  const campaign = value.campaign;
  if (
    !isRecord(campaign) ||
    typeof campaign.id !== "string" ||
    typeof campaign.name !== "string" ||
    (campaign.status !== "draft" && campaign.status !== "active" && campaign.status !== "archived") ||
    typeof campaign.createdAt !== "string" ||
    typeof campaign.updatedAt !== "string"
  ) {
    return false;
  }
  if (!requireMapView) return true;
  return campaign.defaultMapView === null || isMapCameraView(campaign.defaultMapView);
}

function hasValidBaseCollections(value: Record<string, unknown>, requireMapView: boolean) {
  return (
    typeof value.revision === "number" &&
    hasValidCampaign(value, requireMapView) &&
    Array.isArray(value.teams) &&
    value.teams.every(isTeam) &&
    Array.isArray(value.areas) &&
    value.areas.every(isArea)
  );
}

function isCampaignSnapshot(value: unknown): value is CampaignSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === 3 &&
    hasValidBaseCollections(value, true) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isDistributionTask)
  );
}

function isSnapshotV2(value: unknown): value is SnapshotV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    hasValidBaseCollections(value, false) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isDistributionTask)
  );
}

function isSnapshotV1(value: unknown): value is SnapshotV1 {
  return isRecord(value) && value.schemaVersion === 1 && hasValidBaseCollections(value, false);
}

function migrateV2(snapshot: SnapshotV2): CampaignSnapshot {
  return {
    ...snapshot,
    schemaVersion: 3,
    campaign: { ...snapshot.campaign, defaultMapView: null },
  };
}

function migrateV1(snapshot: SnapshotV1): CampaignSnapshot {
  return migrateV2({ ...snapshot, schemaVersion: 2, tasks: [] });
}

function parseSnapshot(raw: string | null): CampaignSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCampaignSnapshot(parsed)) return parsed;
    if (isSnapshotV2(parsed)) return migrateV2(parsed);
    if (isSnapshotV1(parsed)) return migrateV1(parsed);
    return null;
  } catch {
    return null;
  }
}

function localStorageKey(key: string) {
  return collectionModeFromUrl() ? key + ":collection" : key;
}

function writeLocalSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return null;
  const serialized = JSON.stringify(snapshot);
  try {
    window.localStorage.setItem(localStorageKey(STORAGE_KEY), serialized);
  } catch {
    return "Lokales Speichern ist fehlgeschlagen. Bitte diese Seite noch nicht neu laden.";
  }
  try {
    window.localStorage.setItem(localStorageKey(BACKUP_STORAGE_KEY), serialized);
  } catch {
    return "Gespeichert, aber die lokale Sicherheitskopie konnte nicht aktualisiert werden.";
  }
  return null;
}

function sameSnapshotContent(a: CampaignSnapshot, b: CampaignSnapshot) {
  return JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });
}

function isAccessError(error: unknown) {
  return error instanceof CampaignApiError && (error.status === 401 || error.code === "access_required");
}

function isRetryableError(error: unknown) {
  return (
    error instanceof CampaignApiError &&
    (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

function retryDelay(attemptCount: number) {
  return Math.min(MAX_RETRY_DELAY_MS, 1500 * 2 ** Math.min(attemptCount, 5));
}

function setAccess(access: AccessInfo | null) {
  syncRuntime.access = access;
  emit({ access, messageCode: access ? null : "access_required" });
}

function applyServerSnapshot(snapshot: CampaignSnapshot, messageCode: SyncMessageCode = null) {
  syncRuntime.latestLocal = snapshot;
  syncRuntime.lastServer = snapshot;
  syncRuntime.serverRevision = snapshot.revision;
  syncRuntime.remoteRevision = null;
  syncRuntime.needsCanonicalRefresh = false;
  writeLocalSnapshot(snapshot);
  emit({ snapshot, messageCode });
}

function stateFromQueue(records: QueuedCampaignMutation[]): MutationSyncState {
  if (records.some((record) => record.state === "conflict")) return "conflict";
  if (records.some((record) => record.state === "blocked-auth")) return "blocked-auth";
  if (records.some((record) => record.state === "invalid")) return "failed";
  if (records.length === 0 && syncRuntime.enqueuesPending === 0) return "saved";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (syncRuntime.queueInFlight) return "syncing";
  if (records.some((record) => record.state === "retry")) return "failed";
  return "pending";
}

function emitQueueState(records: QueuedCampaignMutation[]) {
  emit({
    syncState: stateFromQueue(records),
    pendingCount: records.length + syncRuntime.enqueuesPending,
  });
}

async function listQueue(campaignId: string) {
  try {
    return await browserMutationQueue.list(campaignId);
  } catch (error) {
    console.warn("mutation_queue_read_failed", error);
    emit({ syncState: "failed", messageCode: "network" });
    return null;
  }
}

function clearRetryTimer() {
  if (typeof window === "undefined" || syncRuntime.retryTimer === null) return;
  window.clearTimeout(syncRuntime.retryTimer);
  syncRuntime.retryTimer = null;
}

function scheduleRetry(delayMs: number) {
  if (typeof window === "undefined") return;
  clearRetryTimer();
  syncRuntime.retryTimer = window.setTimeout(() => {
    syncRuntime.retryTimer = null;
    void processMutationQueue();
  }, Math.max(1000, delayMs));
}

async function resumeBlockedMutations(campaignId: string) {
  const records = await listQueue(campaignId);
  if (!records) return;
  for (const record of records) {
    if (record.state !== "blocked-auth") continue;
    await browserMutationQueue.update({
      ...record,
      state: "pending",
      nextAttemptAt: 0,
      lastError: undefined,
    });
  }
}

async function finalizeQueueIfPossible(campaignId: string) {
  if (syncRuntime.enqueuesPending > 0) return;
  const remaining = await listQueue(campaignId);
  if (!remaining || remaining.length > 0) {
    if (remaining) emitQueueState(remaining);
    return;
  }

  emitQueueState([]);
  if (syncRuntime.interactionBlocked) {
    syncRuntime.needsCanonicalRefresh = true;
    return;
  }

  try {
    const canonical = collectionModeFromUrl()
      ? await fetchCollectionSnapshot(campaignId)
      : await fetchCampaignSnapshot(campaignId);
    applyServerSnapshot(canonical);
    emit({ syncState: "saved", pendingCount: 0 });
  } catch (error) {
    syncRuntime.needsCanonicalRefresh = true;
    if (isAccessError(error)) {
      syncRuntime.initialized = false;
      setAccess(null);
      emit({ syncState: "blocked-auth", pendingCount: 0 });
    } else {
      emit({ syncState: "failed", messageCode: "network", pendingCount: 0 });
    }
  }
}

async function processMutationQueue() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.initialized ||
    syncRuntime.queueInFlight ||
    !syncRuntime.targetCampaignId ||
    syncRuntime.access?.role === "viewer"
  ) {
    if (syncRuntime.targetCampaignId) {
      const records = await listQueue(syncRuntime.targetCampaignId);
      if (records) emitQueueState(records);
    }
    return;
  }

  const campaignId = syncRuntime.targetCampaignId;
  const records = await listQueue(campaignId);
  if (!records) return;
  if (records.length === 0) {
    await finalizeQueueIfPossible(campaignId);
    return;
  }

  const record = records[0];
  if (record.state === "conflict" || record.state === "blocked-auth" || record.state === "invalid") {
    emitQueueState(records);
    return;
  }

  const delay = record.nextAttemptAt - Date.now();
  if (delay > 0) {
    emitQueueState(records);
    scheduleRetry(delay);
    return;
  }

  clearRetryTimer();
  syncRuntime.queueInFlight = true;
  emit({ syncState: "syncing", pendingCount: records.length + syncRuntime.enqueuesPending });

  try {
    const result = await postCampaignMutation(campaignId, record.mutation);
    await browserMutationQueue.remove(record.id);
    syncRuntime.serverRevision = result.appliedRevision;
    syncRuntime.lastServer = null;
    syncRuntime.remoteRevision = null;
    syncRuntime.needsCanonicalRefresh = true;
  } catch (error) {
    const apiError = error instanceof CampaignApiError ? error : null;
    const lastError = error instanceof Error ? error.message : "Mutation konnte nicht synchronisiert werden.";

    if (apiError?.status === 409) {
      await browserMutationQueue.update({
        ...record,
        state: "conflict",
        attemptCount: record.attemptCount + 1,
        lastError,
      });
      if (syncRuntime.latestLocal) saveCampaignConflictSnapshot(syncRuntime.latestLocal);
      if (apiError.revision !== undefined && apiError.revision !== null) {
        syncRuntime.serverRevision = apiError.revision;
      }
      emit({ syncState: "conflict", messageCode: "conflict", pendingCount: records.length });
      return;
    }

    if (apiError && (apiError.status === 401 || apiError.status === 403)) {
      await browserMutationQueue.update({
        ...record,
        state: "blocked-auth",
        attemptCount: record.attemptCount + 1,
        lastError,
      });
      if (apiError.status === 401) {
        syncRuntime.initialized = false;
        setAccess(null);
      }
      emit({
        syncState: "blocked-auth",
        messageCode: apiError.status === 403 ? "forbidden" : "access_required",
        pendingCount: records.length,
      });
      return;
    }

    if (apiError?.code === "schema_migration_required") {
      const attemptCount = record.attemptCount + 1;
      const nextAttemptAt = Date.now() + retryDelay(attemptCount);
      await browserMutationQueue.update({
        ...record,
        state: "retry",
        attemptCount,
        nextAttemptAt,
        lastError,
      });
      emit({
        syncState: "failed",
        messageCode: "schema_migration_required",
        pendingCount: records.length,
      });
      if (navigator.onLine) scheduleRetry(nextAttemptAt - Date.now());
      return;
    }

    if (apiError && apiError.status >= 400 && apiError.status < 500 && !isRetryableError(apiError)) {
      await browserMutationQueue.update({
        ...record,
        state: "invalid",
        attemptCount: record.attemptCount + 1,
        lastError,
      });
      emit({ syncState: "failed", messageCode: "conflict", pendingCount: records.length });
      return;
    }

    const attemptCount = record.attemptCount + 1;
    const nextAttemptAt = Date.now() + retryDelay(attemptCount);
    await browserMutationQueue.update({
      ...record,
      state: "retry",
      attemptCount,
      nextAttemptAt,
      lastError,
    });
    emit({
      syncState: navigator.onLine ? "failed" : "offline",
      messageCode: "network",
      pendingCount: records.length,
    });
    if (navigator.onLine) scheduleRetry(nextAttemptAt - Date.now());
    return;
  } finally {
    syncRuntime.queueInFlight = false;
  }

  const after = await listQueue(campaignId);
  if (!after) return;
  emitQueueState(after);
  if (after.length > 0) {
    queueMicrotask(() => void processMutationQueue());
  } else {
    await finalizeQueueIfPossible(campaignId);
  }
}

async function recoverLegacyOptimisticSnapshot(
  campaignId: string,
  local: CampaignSnapshot,
  server: CampaignSnapshot,
) {
  if (syncRuntime.access?.role === "viewer" || collectionModeFromUrl()) return false;
  if (local.revision <= server.revision || sameSnapshotContent(local, server)) return false;

  try {
    const outgoing: CampaignSnapshot = { ...local, revision: server.revision + 1 };
    const stored = await putCampaignSnapshot(campaignId, server.revision, outgoing);
    applyServerSnapshot(stored);
    emit({ syncState: "saved", pendingCount: 0 });
    return true;
  } catch (error) {
    saveCampaignConflictSnapshot(local);
    if (isRetryableError(error)) {
      emit({ syncState: "failed", messageCode: "network", pendingCount: 0 });
    } else if (isAccessError(error)) {
      syncRuntime.initialized = false;
      setAccess(null);
      emit({ syncState: "blocked-auth", pendingCount: 0 });
    } else {
      emit({ syncState: "conflict", messageCode: "conflict", pendingCount: 0 });
    }
    return true;
  }
}

async function loadServerForAuthenticatedCampaign(targetCampaignId: string) {
  const serverSnapshot = collectionModeFromUrl()
    ? await fetchCollectionSnapshot(targetCampaignId)
    : await fetchCampaignSnapshot(targetCampaignId);
  const latestLocal = syncRuntime.latestLocal;
  syncRuntime.serverRevision = serverSnapshot.revision;
  syncRuntime.lastServer = serverSnapshot;
  syncRuntime.remoteRevision = null;
  syncRuntime.needsCanonicalRefresh = false;
  syncRuntime.initialized = true;

  await resumeBlockedMutations(targetCampaignId);
  const queue = await listQueue(targetCampaignId);
  if (!queue) return;

  if (queue.length > 0) {
    if (!latestLocal || latestLocal.campaign.id !== targetCampaignId) {
      if (latestLocal && loadedExistingSnapshot) saveCampaignConflictSnapshot(latestLocal);
      applyServerSnapshot(serverSnapshot);
    }
    if (syncRuntime.access?.role === "viewer") {
      const first = queue[0];
      await browserMutationQueue.update({
        ...first,
        state: "blocked-auth",
        lastError: "Read-only Viewer dürfen keine wartenden Änderungen schreiben.",
      });
      emit({ syncState: "blocked-auth", pendingCount: queue.length, messageCode: "forbidden" });
      return;
    }
    emitQueueState(queue);
    void processMutationQueue();
    return;
  }

  if (!latestLocal || latestLocal.campaign.id !== targetCampaignId) {
    if (latestLocal && loadedExistingSnapshot) saveCampaignConflictSnapshot(latestLocal);
    applyServerSnapshot(serverSnapshot);
    emit({ syncState: "saved", pendingCount: 0 });
    return;
  }

  if (syncRuntime.access?.role === "viewer") {
    if (!sameSnapshotContent(latestLocal, serverSnapshot) && loadedExistingSnapshot) {
      saveCampaignConflictSnapshot(latestLocal);
    }
    applyServerSnapshot(serverSnapshot);
    emit({ syncState: "saved", pendingCount: 0 });
    return;
  }

  if (await recoverLegacyOptimisticSnapshot(targetCampaignId, latestLocal, serverSnapshot)) return;

  const sameContent = sameSnapshotContent(latestLocal, serverSnapshot);
  if (latestLocal.revision === serverSnapshot.revision && !sameContent) {
    saveCampaignConflictSnapshot(latestLocal);
    emit({ syncState: "conflict", messageCode: "conflict", pendingCount: 0 });
    return;
  }

  if (serverSnapshot.revision > latestLocal.revision || !sameContent) {
    if (!sameContent && loadedExistingSnapshot) saveCampaignConflictSnapshot(latestLocal);
    applyServerSnapshot(serverSnapshot, !sameContent ? "conflict" : null);
    emit({ syncState: "saved", pendingCount: 0 });
    return;
  }

  syncRuntime.latestLocal = serverSnapshot;
  writeLocalSnapshot(serverSnapshot);
  emit({ syncState: "saved", pendingCount: 0 });
}

async function initializeSharedPersistence() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    syncRuntime.initialized ||
    syncRuntime.initializeInFlight ||
    !syncRuntime.latestLocal
  ) {
    return;
  }

  syncRuntime.initializeInFlight = true;
  const localAtStart = syncRuntime.latestLocal;
  const urlCampaignId = campaignIdFromUrl();
  const targetCampaignId = urlCampaignId ?? localAtStart.campaign.id;
  syncRuntime.targetCampaignId = targetCampaignId;
  setCampaignIdInUrl(targetCampaignId);

  try {
    const collectionToken = collectionAccessTokenFromUrl();
    if (collectionModeFromUrl()) {
      try {
        if (collectionToken) {
          setAccess(await redeemCollectionAccess(targetCampaignId, collectionToken));
          removeCollectionAccessTokenFromUrl();
        } else {
          setAccess(await fetchCurrentCollectionAccess(targetCampaignId));
        }
        await loadServerForAuthenticatedCampaign(targetCampaignId);
        return;
      } catch (error) {
        if (!isAccessError(error)) throw error;
        syncRuntime.initialized = false;
        setAccess(null);
        return;
      }
    }
    const fragmentToken = accessTokenFromUrl();
    if (fragmentToken) {
      try {
        setAccess(await redeemCampaignAccess(targetCampaignId, fragmentToken));
      } finally {
        removeAccessTokenFromUrl();
      }
      await loadServerForAuthenticatedCampaign(targetCampaignId);
      return;
    }

    try {
      setAccess(await fetchCurrentAccess(targetCampaignId));
      await loadServerForAuthenticatedCampaign(targetCampaignId);
      return;
    } catch (error) {
      if (!isAccessError(error)) throw error;
    }

    if (!loadedExistingSnapshot && !urlCampaignId && localAtStart.campaign.id === targetCampaignId) {
      const created = await createCampaignSnapshot(localAtStart);
      syncRuntime.access = created.access;
      syncRuntime.initialized = true;
      syncRuntime.targetCampaignId = created.snapshot.campaign.id;
      setCampaignIdInUrl(created.snapshot.campaign.id);
      applyServerSnapshot(created.snapshot);
      emit({
        access: created.access,
        initialAccessUrl: buildCampaignAccessUrl(
          created.snapshot.campaign.id,
          created.initialAccessToken,
        ),
        messageCode: null,
        syncState: "saved",
        pendingCount: 0,
      });
      return;
    }

    syncRuntime.initialized = false;
    setAccess(null);
  } catch (error) {
    syncRuntime.initialized = false;
    if (isRetryableError(error)) {
      emit({ messageCode: "network", syncState: "offline" });
    } else if (isAccessError(error)) {
      setAccess(null);
    } else {
      console.warn("campaign_sync_initialize_failed", error);
      emit({ syncState: "failed" });
    }
  } finally {
    syncRuntime.initializeInFlight = false;
  }
}

async function refreshFromServer(manual: boolean) {
  if (manual) setRefreshState("loading");

  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.targetCampaignId ||
    syncRuntime.serverRevision === null
  ) {
    if (manual) setRefreshState("error", true);
    return;
  }

  const queue = await listQueue(syncRuntime.targetCampaignId);
  if (!queue) {
    if (manual) setRefreshState("error", true);
    return;
  }

  if (queue.length > 0 || syncRuntime.enqueuesPending > 0 || syncRuntime.queueInFlight) {
    await processMutationQueue();
    const remaining = await listQueue(syncRuntime.targetCampaignId);
    if (!remaining || remaining.length > 0 || syncRuntime.enqueuesPending > 0) {
      if (manual) setRefreshState("error", true);
      return;
    }
  }

  try {
    if (syncRuntime.needsCanonicalRefresh) {
      if (syncRuntime.interactionBlocked) {
        setRefreshState("available");
        return;
      }
      applyServerSnapshot(
        await (collectionModeFromUrl()
          ? fetchCollectionSnapshot(syncRuntime.targetCampaignId)
          : fetchCampaignSnapshot(syncRuntime.targetCampaignId)),
      );
      if (manual) setRefreshState("current", true);
      return;
    }

    if (collectionModeFromUrl()) {
      applyServerSnapshot(await fetchCollectionSnapshot(syncRuntime.targetCampaignId));
      if (manual) setRefreshState("current", true);
      return;
    }
    const revision = await fetchCampaignVersion(syncRuntime.targetCampaignId);
    if (revision <= syncRuntime.serverRevision) {
      if (manual) setRefreshState("current", true);
      return;
    }

    syncRuntime.remoteRevision = revision;
    if (syncRuntime.interactionBlocked) {
      setRefreshState("available");
      return;
    }

    applyServerSnapshot(await fetchCampaignSnapshot(syncRuntime.targetCampaignId));
    if (manual) setRefreshState("current", true);
    else setRefreshState("idle");
  } catch (error) {
    if (isAccessError(error)) {
      syncRuntime.initialized = false;
      setAccess(null);
      emit({ syncState: "blocked-auth" });
    } else if (isRetryableError(error)) {
      emit({ messageCode: "network" });
    } else {
      console.warn("campaign_version_poll_failed", error);
    }
    if (manual) setRefreshState("error", true);
  }
}

function startSharedPersistenceRuntime() {
  if (typeof window === "undefined" || syncRuntime.listenersStarted) return;
  syncRuntime.listenersStarted = true;

  window.addEventListener("online", () => {
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else void processMutationQueue().then(() => refreshFromServer(false));
  });
  window.addEventListener("offline", () => {
    if (!syncRuntime.targetCampaignId) return;
    void listQueue(syncRuntime.targetCampaignId).then((records) => {
      if (records) emitQueueState(records);
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else void processMutationQueue().then(() => refreshFromServer(false));
  });
  window.setInterval(() => {
    if (syncRuntime.initialized) void refreshFromServer(false);
  }, POLL_INTERVAL_MS);
}

export function subscribeCampaignStore(listener: (update: CampaignStoreUpdate) => void) {
  listeners.add(listener);
  if (syncRuntime.access) listener({ access: syncRuntime.access });
  return () => {
    listeners.delete(listener);
  };
}

export function setCampaignInteractionBlocked(blocked: boolean) {
  syncRuntime.interactionBlocked = blocked;
  if (!blocked) void processMutationQueue().then(() => refreshFromServer(false));
}

export function manualRefreshCampaign() {
  if (!syncRuntime.initialized) {
    setRefreshState("loading");
    void initializeSharedPersistence().finally(() => {
      if (syncRuntime.initialized) void refreshFromServer(true);
      else setRefreshState("error", true);
    });
    return;
  }
  void refreshFromServer(true);
}

export function loadCampaignSnapshot(): CampaignLoadResult {
  if (typeof window === "undefined") {
    return { snapshot: createInitialSnapshot(), warning: null };
  }

  try {
    const primaryRaw = window.localStorage.getItem(localStorageKey(STORAGE_KEY));
    const backupRaw = window.localStorage.getItem(localStorageKey(BACKUP_STORAGE_KEY));
    const legacyRaw = window.localStorage.getItem(localStorageKey(LEGACY_STORAGE_KEY));
    const primary = parseSnapshot(primaryRaw);
    if (primary) {
      loadedExistingSnapshot = true;
      return { snapshot: primary, warning: null };
    }

    const backup = parseSnapshot(backupRaw);
    if (backup) {
      loadedExistingSnapshot = true;
      return {
        snapshot: backup,
        warning: primaryRaw
          ? "Die lokale Hauptdatei war beschädigt. Eine lokale Sicherung wurde geladen."
          : null,
      };
    }

    const legacy = parseSnapshot(legacyRaw);
    if (legacy) {
      loadedExistingSnapshot = true;
      writeLocalSnapshot(legacy);
      return { snapshot: legacy, warning: null };
    }

    loadedExistingSnapshot = false;
    if (primaryRaw || backupRaw || legacyRaw) {
      return {
        snapshot: createInitialSnapshot(),
        warning: "Lokale Daten konnten nicht wiederhergestellt werden.",
      };
    }
    return { snapshot: createInitialSnapshot(), warning: null };
  } catch {
    loadedExistingSnapshot = false;
    return {
      snapshot: createInitialSnapshot(),
      warning: "Lokale Daten konnten nicht gelesen werden.",
    };
  }
}

export function saveCampaignSnapshot(snapshot: CampaignSnapshot) {
  const warning = writeLocalSnapshot(snapshot);
  if (typeof window === "undefined") return warning;

  startSharedPersistenceRuntime();
  const previous = syncRuntime.latestLocal;
  syncRuntime.latestLocal = snapshot;

  if (!previous) {
    void initializeSharedPersistence();
    return warning;
  }

  if (previous.campaign.id !== snapshot.campaign.id) {
    syncRuntime.initialized = false;
    syncRuntime.targetCampaignId = snapshot.campaign.id;
    void initializeSharedPersistence();
    return warning;
  }

  let mutation;
  try {
    mutation = deriveCampaignMutation(previous, snapshot);
  } catch (error) {
    if (error instanceof MutationDerivationError) {
      saveCampaignConflictSnapshot(snapshot);
      emit({ syncState: "failed", messageCode: "conflict" });
      console.warn("mutation_derivation_failed", error.message);
      return warning;
    }
    throw error;
  }

  if (!mutation) {
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    return warning;
  }

  syncRuntime.enqueuesPending += 1;
  emit({ syncState: navigator.onLine ? "pending" : "offline" });
  enqueueChain = enqueueChain
    .then(async () => {
      try {
        await browserMutationQueue.enqueue(mutation);
      } catch (error) {
        saveCampaignConflictSnapshot(snapshot);
        emit({ syncState: "failed", messageCode: "network" });
        console.warn("mutation_queue_write_failed", error);
        return;
      } finally {
        syncRuntime.enqueuesPending -= 1;
      }

      const records = await listQueue(mutation.campaignId);
      if (records) emitQueueState(records);
      if (!syncRuntime.initialized) await initializeSharedPersistence();
      await processMutationQueue();
    })
    .catch((error) => {
      syncRuntime.enqueuesPending = Math.max(0, syncRuntime.enqueuesPending - 1);
      console.warn("mutation_enqueue_chain_failed", error);
      emit({ syncState: "failed", messageCode: "network" });
    });

  return warning;
}

export function saveCampaignConflictSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      localStorageKey(CONFLICT_STORAGE_KEY),
      JSON.stringify({ savedAt: new Date().toISOString(), snapshot }),
    );
    return true;
  } catch {
    return false;
  }
}
