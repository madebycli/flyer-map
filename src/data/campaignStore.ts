import {
  CampaignApiError,
  accessTokenFromUrl,
  buildCampaignAccessUrl,
  campaignIdFromUrl,
  collectionAccessTokenFromUrl,
  collectionModeFromUrl,
  createCampaignSnapshot,
  fetchCollectionSnapshot,
  fetchCurrentAccess,
  fetchCurrentCollectionAccess,
  postCampaignMutation,
  redeemCampaignAccess,
  redeemCollectionAccess,
  removeAccessTokenFromUrl,
  removeCollectionAccessTokenFromUrl,
  setCampaignIdInUrl,
  type AccessInfo,
} from "./campaignApi.ts";
import { browserMutationQueue } from "./mutationQueue.ts";
import { MissionRxdbSync, type RxdbSyncIssue } from "./rxdbMissionSync.ts";
import { createInitialSnapshot, normalizeAreaPreparationGenerations, type Area, type CampaignSnapshot, type DistributionTask, type HouseTask, type LineStringGeometry, type MapCameraView, type PolygonGeometry, type Team } from "../domain/campaign.ts";
import { deriveCampaignMutation, MutationDerivationError } from "../domain/mutationDiff.ts";
import type { CampaignMutation } from "../domain/mutations.ts";
import type { DurableCampaignMutation } from "../domain/durableMutation.ts";

const STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const BACKUP_STORAGE_KEY = "verteil-flyer:campaign-snapshot:backup";
const CONFLICT_STORAGE_KEY = "verteil-flyer:campaign-snapshot:conflict";
const LEGACY_STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";
const RXDB_LEGACY_MIGRATION_KEY_PREFIX = "verteil-flyer:rxdb-m5-migration:v1";
const RXDB_LEGACY_ARCHIVE_KEY_PREFIX = "verteil-flyer:rxdb-m5-archive";
const FIELD_GROUP_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

export type CampaignLoadResult = { snapshot: CampaignSnapshot; warning: string | null };
export type RefreshState = "idle" | "loading" | "current" | "error" | "available";
export type CampaignAccessState = "idle" | "pending" | "authenticated" | "required";
export type SyncMessageCode = "access_required" | "network" | "conflict" | "forbidden" | "schema_migration_required" | null;
export type MutationSyncState = "local-saved" | "waiting-server" | "server-confirmed" | "syncing" | "offline" | "conflict" | "failed" | "blocked-auth";
export type SyncIssue = {
  kind: "server-wins" | "blocked-auth" | "network" | "schema";
  mutationType?: string;
  serverRevision?: number | null;
  baseRevision?: number | null;
  message: string;
  occurredAt: string;
};
export type CampaignStoreUpdate = {
  snapshot?: CampaignSnapshot;
  access?: AccessInfo | null;
  accessState?: CampaignAccessState;
  refreshState?: RefreshState;
  messageCode?: SyncMessageCode;
  initialAccessUrl?: string;
  syncState?: MutationSyncState;
  pendingCount?: number;
  syncIssue?: SyncIssue | null;
};

type Runtime = {
  targetCampaignId: string | null;
  latestLocal: CampaignSnapshot | null;
  access: AccessInfo | null;
  accessState: CampaignAccessState;
  initialized: boolean;
  initializing: boolean;
  listenersStarted: boolean;
  interactionBlocked: boolean;
  deferredSnapshot: CampaignSnapshot | null;
  activeFieldGroupId: string | null;
  sync: MissionRxdbSync | null;
  pendingWrites: number;
  retryLegacyMigration: (() => void) | null;
};

const runtime: Runtime = {
  targetCampaignId: null,
  latestLocal: null,
  access: null,
  accessState: "idle",
  initialized: false,
  initializing: false,
  listenersStarted: false,
  interactionBlocked: false,
  deferredSnapshot: null,
  activeFieldGroupId: null,
  sync: null,
  pendingWrites: 0,
  retryLegacyMigration: null,
};

const listeners = new Set<(update: CampaignStoreUpdate) => void>();
let loadedExistingSnapshot = false;
let saveChain: Promise<void> = Promise.resolve();
let refreshResetTimer: number | null = null;

function emit(update: CampaignStoreUpdate) {
  for (const listener of listeners) listener(update);
}

function setAccess(access: AccessInfo | null) {
  runtime.access = access;
  runtime.accessState = access ? "authenticated" : "required";
  emit({ access, accessState: runtime.accessState, messageCode: access ? null : "access_required" });
}

function isAccessError(error: unknown) {
  return error instanceof CampaignApiError && (error.status === 401 || error.code === "access_required");
}

function setRefreshState(state: RefreshState, reset = false) {
  emit({ refreshState: state });
  if (!reset || typeof window === "undefined") return;
  if (refreshResetTimer !== null) window.clearTimeout(refreshResetTimer);
  refreshResetTimer = window.setTimeout(() => emit({ refreshState: "idle" }), 1800);
}

function localStorageKey(key: string) {
  return collectionModeFromUrl() ? `${key}:collection` : key;
}

function writeLocalSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return null;
  const serialized = JSON.stringify(snapshot);
  try {
    window.localStorage.setItem(localStorageKey(STORAGE_KEY), serialized);
  } catch {
    return "Lokale Daten konnten nicht dauerhaft gespeichert werden.";
  }
  try {
    window.localStorage.setItem(localStorageKey(BACKUP_STORAGE_KEY), serialized);
    return null;
  } catch {
    return "Gespeichert, aber die lokale Sicherheitskopie konnte nicht aktualisiert werden.";
  }
}

type LegacyCampaign = Omit<CampaignSnapshot["campaign"], "defaultMapView">;
type SnapshotV2 = Omit<CampaignSnapshot, "schemaVersion" | "campaign"> & { schemaVersion: 2; campaign: LegacyCampaign };
type SnapshotV1 = Omit<SnapshotV2, "schemaVersion" | "tasks"> & { schemaVersion: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLngLat(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && Number.isFinite(value[0]) && typeof value[1] === "number" && Number.isFinite(value[1]);
}

function isMapCameraView(value: unknown): value is MapCameraView {
  return isRecord(value) && isLngLat(value.center) && typeof value.zoom === "number" && Number.isFinite(value.zoom) && typeof value.bearing === "number" && Number.isFinite(value.bearing);
}

function isPolygonGeometry(value: unknown): value is PolygonGeometry {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) return false;
  const firstRing = value.coordinates[0];
  return Array.isArray(firstRing) && firstRing.every(isLngLat);
}

function isLineStringGeometry(value: unknown): value is LineStringGeometry {
  return isRecord(value) && value.type === "LineString" && Array.isArray(value.coordinates) && value.coordinates.every(isLngLat);
}

function isTeam(value: unknown): value is Team {
  return isRecord(value) && typeof value.id === "string" && typeof value.campaignId === "string" && typeof value.name === "string" && typeof value.color === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isArea(value: unknown): value is Area {
  return isRecord(value) && typeof value.id === "string" && typeof value.campaignId === "string" && typeof value.teamId === "string" && typeof value.name === "string" && isPolygonGeometry(value.geometry) && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isDistributionTask(value: unknown): value is DistributionTask {
  return isRecord(value) && typeof value.id === "string" && typeof value.campaignId === "string" && typeof value.areaId === "string" && value.taskType === "street" && typeof value.label === "string" && isLineStringGeometry(value.geometry) && (value.status === "open" || value.status === "completed" || value.status === "later" || value.status === "not-deliverable") && (value.completedAt === null || typeof value.completedAt === "string") && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isHouseTask(value: unknown): value is HouseTask {
  return isRecord(value) && typeof value.id === "string" && typeof value.campaignId === "string" && typeof value.areaId === "string" && value.taskType === "house" && typeof value.label === "string" && isPolygonGeometry(value.geometry) && (value.parentStreetTaskId === null || typeof value.parentStreetTaskId === "string") && (value.status === "open" || value.status === "completed" || value.status === "later" || value.status === "not-deliverable") && (value.completedAt === null || typeof value.completedAt === "string") && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function hasValidCampaign(value: Record<string, unknown>, requireMapView: boolean) {
  const campaign = value.campaign;
  if (!isRecord(campaign) || typeof campaign.id !== "string" || typeof campaign.name !== "string" || (campaign.status !== "draft" && campaign.status !== "active" && campaign.status !== "archived") || typeof campaign.createdAt !== "string" || typeof campaign.updatedAt !== "string") return false;
  return !requireMapView || campaign.defaultMapView === null || isMapCameraView(campaign.defaultMapView);
}

function hasValidBaseCollections(value: Record<string, unknown>, requireMapView: boolean) {
  return typeof value.revision === "number" && Number.isFinite(value.revision) && hasValidCampaign(value, requireMapView) && Array.isArray(value.teams) && value.teams.every(isTeam) && Array.isArray(value.areas) && value.areas.every(isArea);
}

function isCampaignSnapshot(value: unknown): value is CampaignSnapshot {
  return isRecord(value) && value.schemaVersion === 3 && hasValidBaseCollections(value, true) && Array.isArray(value.tasks) && value.tasks.every(isDistributionTask) && (value.houseTasks === undefined || Array.isArray(value.houseTasks) && value.houseTasks.every(isHouseTask));
}

function isSnapshotV2(value: unknown): value is SnapshotV2 {
  return isRecord(value) && value.schemaVersion === 2 && hasValidBaseCollections(value, false) && Array.isArray(value.tasks) && value.tasks.every(isDistributionTask);
}

function isSnapshotV1(value: unknown): value is SnapshotV1 {
  return isRecord(value) && value.schemaVersion === 1 && hasValidBaseCollections(value, false);
}

function parseSnapshot(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const migrated = isCampaignSnapshot(parsed)
      ? parsed
      : isSnapshotV2(parsed)
        ? { ...parsed, schemaVersion: 3, campaign: { ...parsed.campaign, defaultMapView: null } }
        : isSnapshotV1(parsed)
          ? { ...parsed, schemaVersion: 3, tasks: [], campaign: { ...parsed.campaign, defaultMapView: null } }
          : null;
    return migrated ? normalizeAreaPreparationGenerations(migrated as CampaignSnapshot) : null;
  } catch {
    return null;
  }
}

function applyRxdbSnapshot(snapshot: CampaignSnapshot) {
  const normalized = normalizeAreaPreparationGenerations(snapshot);
  if (runtime.interactionBlocked) {
    runtime.deferredSnapshot = normalized;
    setRefreshState("available");
    return;
  }
  runtime.latestLocal = normalized;
  writeLocalSnapshot(normalized);
  emit({ snapshot: normalized, pendingCount: runtime.pendingWrites, messageCode: null });
}

function reportRxdbIssue(issue: RxdbSyncIssue) {
  const schema = issue.kind === "schema" || issue.code.includes("schema_unavailable");
  const blocked = issue.code.includes("forbidden") || issue.code.includes("read_only") || issue.code.includes("access_required") || issue.code.includes("field_group_actor_scope");
  const syncIssue: SyncIssue = {
    kind: schema ? "schema" : blocked ? "blocked-auth" : issue.kind === "rejected" ? "server-wins" : "network",
    mutationType: issue.collectionName,
    message: schema
      ? "Diese eine Änderung wartet auf die vorbereitete Datenbankmigration. Die übrigen Daten können weiter gelesen werden."
      : blocked
        ? "Diese eine Änderung darf mit dem aktuellen Zugriff nicht übernommen werden. Die übrigen Daten werden weiter synchronisiert."
        : issue.kind === "rejected"
          ? "Diese eine Änderung konnte nicht automatisch übernommen werden. Die übrigen Daten werden weiter synchronisiert."
          : "Die Verbindung wird erneut aufgebaut. Bereits geladene Daten bleiben verfügbar.",
    occurredAt: new Date().toISOString(),
  };
  emit({ syncIssue, syncState: schema ? "failed" : blocked ? "blocked-auth" : issue.kind === "rejected" ? "conflict" : navigator.onLine ? "failed" : "offline", messageCode: schema ? "schema_migration_required" : blocked ? "forbidden" : "network" });
}

function isReplayableLegacyMutation(mutation: CampaignMutation) {
  return mutation.type === "campaign.rename" || mutation.type === "team.update" || mutation.type === "task.set-status" || mutation.type === "house.set-status";
}

async function migrateLegacyM5Records(campaignId: string, sync: MissionRxdbSync) {
  const migrationKey = `${RXDB_LEGACY_MIGRATION_KEY_PREFIX}:${encodeURIComponent(campaignId)}`;
  const archiveKey = `${RXDB_LEGACY_ARCHIVE_KEY_PREFIX}:${encodeURIComponent(campaignId)}`;
  if (typeof window === "undefined" || window.localStorage.getItem(migrationKey)) return;
  const records = await browserMutationQueue.list(campaignId);
  const backup = { migratedAt: new Date().toISOString(), records, replayedMutationIds: [] as string[], needsResolutionMutationIds: [] as string[] };
  const persistArchive = () => window.localStorage.setItem(archiveKey, JSON.stringify(backup));
  // Never remove a queue record before the complete recovery archive is durable.
  try {
    persistArchive();
  } catch {
    return;
  }
  for (const record of records) {
    if (isReplayableLegacyMutation(record.mutation)) {
      try {
        await sync.applyMutation(record.mutation);
        backup.replayedMutationIds.push(record.id);
      } catch {
        backup.needsResolutionMutationIds.push(record.id);
      }
    } else {
      backup.needsResolutionMutationIds.push(record.id);
    }
    persistArchive();
    await browserMutationQueue.remove(record.id);
  }
  persistArchive();
  window.localStorage.setItem(migrationKey, JSON.stringify({ completedAt: backup.migratedAt }));
  if (backup.needsResolutionMutationIds.length > 0) {
    emit({ syncState: "conflict", syncIssue: { kind: "server-wins", message: "Strukturelle alte Offline-Änderungen wurden sicher gesichert und nicht blind wiederholt. Die übrigen Daten werden weiter synchronisiert.", occurredAt: backup.migratedAt } });
  }
}

async function startRxdb(campaignId: string) {
  runtime.retryLegacyMigration = null;
  if (runtime.sync) await runtime.sync.destroy();
  const fieldGroupAccess = runtime.access?.role === "field-group-member" ? runtime.access : null;
  const teamScopeId = fieldGroupAccess?.teamId ?? null;
  const actorScopeId = fieldGroupAccess?.groupId ?? null;
  if (fieldGroupAccess && (!teamScopeId || !actorScopeId || !FIELD_GROUP_ID_PATTERN.test(actorScopeId))) {
    throw new Error("field_group_actor_scope_required");
  }
  const sync = new MissionRxdbSync({
    campaignId,
    teamScopeId,
    actorScopeId,
    collectionFallback: fieldGroupAccess ? undefined : runtime.latestLocal?.collection,
    onSnapshot: applyRxdbSnapshot,
    onIssue: reportRxdbIssue,
    onRemoteEvent: (event) => {
      if (event !== "sent" || runtime.sync !== sync) return;
      emit({
        syncState: runtime.pendingWrites > 0 ? "waiting-server" : "server-confirmed",
        pendingCount: runtime.pendingWrites,
        messageCode: null,
      });
    },
  });
  runtime.sync = sync;
  await sync.start();
  runtime.initialized = true;
  emit({ syncState: navigator.onLine ? "waiting-server" : "offline", pendingCount: runtime.pendingWrites, messageCode: null });
  // Legacy M5 intents are copied only after the replica has a canonical
  // Campaign. The old network writer never starts here, and a timeout leaves
  // recovery records intact for the next online start.
  let migrationAttempt: Promise<void> | null = null;
  const retryLegacyMigration = () => {
    if (migrationAttempt) return;
    migrationAttempt = sync.waitForCampaignDocument()
      .then((ready) => ready && runtime.sync === sync ? migrateLegacyM5Records(campaignId, sync) : undefined)
      .catch(() => reportRxdbIssue({ kind: "network", code: "legacy_migration_failed" }))
      .finally(() => { migrationAttempt = null; });
  };
  runtime.retryLegacyMigration = retryLegacyMigration;
  retryLegacyMigration();
}

async function initializeSharedPersistence() {
  if (typeof window === "undefined" || !navigator.onLine || runtime.initialized || runtime.initializing || !runtime.latestLocal) return;
  runtime.initializing = true;
  const local = runtime.latestLocal;
  const targetCampaignId = campaignIdFromUrl() ?? local.campaign.id;
  runtime.targetCampaignId = targetCampaignId;
  setCampaignIdInUrl(targetCampaignId);
  runtime.accessState = "pending";
  emit({ accessState: "pending" });
  try {
    if (collectionModeFromUrl()) {
      const token = collectionAccessTokenFromUrl();
      const access = token ? await redeemCollectionAccess(targetCampaignId, token) : await fetchCurrentCollectionAccess(targetCampaignId);
      if (token) removeCollectionAccessTokenFromUrl();
      setAccess(access);
      applyRxdbSnapshot(await fetchCollectionSnapshot(targetCampaignId));
      runtime.initialized = true;
      return;
    }
    const token = accessTokenFromUrl();
    if (token) {
      try { setAccess(await redeemCampaignAccess(targetCampaignId, token)); } finally { removeAccessTokenFromUrl(); }
      await startRxdb(targetCampaignId);
      return;
    }
    try {
      setAccess(await fetchCurrentAccess(targetCampaignId));
      await startRxdb(targetCampaignId);
      return;
    } catch (error) {
      if (!isAccessError(error)) throw error;
      if (!loadedExistingSnapshot && !campaignIdFromUrl() && local.campaign.id === targetCampaignId) {
        const created = await createCampaignSnapshot(local);
        setAccess(created.access);
        runtime.targetCampaignId = created.snapshot.campaign.id;
        setCampaignIdInUrl(created.snapshot.campaign.id);
        runtime.latestLocal = created.snapshot;
        writeLocalSnapshot(created.snapshot);
        await startRxdb(created.snapshot.campaign.id);
        emit({ initialAccessUrl: buildCampaignAccessUrl(created.snapshot.campaign.id, created.initialAccessToken) });
        return;
      }
      setAccess(null);
    }
  } catch (error) {
    runtime.initialized = false;
    const message = error instanceof Error ? error.message : "sync_initialize_failed";
    reportRxdbIssue({ kind: message.includes("schema") ? "schema" : "network", code: message });
  } finally {
    runtime.initializing = false;
  }
}

function startListeners() {
  if (typeof window === "undefined" || runtime.listenersStarted) return;
  runtime.listenersStarted = true;
  window.addEventListener("online", () => { if (!runtime.initialized) void initializeSharedPersistence(); else { runtime.sync?.refresh(); runtime.retryLegacyMigration?.(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!runtime.initialized) void initializeSharedPersistence(); else { runtime.sync?.refresh(); runtime.retryLegacyMigration?.(); }
    }
  });
}

export function subscribeCampaignStore(listener: (update: CampaignStoreUpdate) => void) {
  listeners.add(listener);
  listener({ access: runtime.access, accessState: runtime.accessState });
  return () => {
    listeners.delete(listener);
  };
}

export function setCampaignInteractionBlocked(blocked: boolean) {
  runtime.interactionBlocked = blocked;
  if (!blocked && runtime.deferredSnapshot) {
    const deferred = runtime.deferredSnapshot;
    runtime.deferredSnapshot = null;
    applyRxdbSnapshot(deferred);
  }
}

export function setCampaignFieldGroupContext(fieldGroupId: string | null) {
  runtime.activeFieldGroupId = typeof fieldGroupId === "string" && FIELD_GROUP_ID_PATTERN.test(fieldGroupId) ? fieldGroupId : null;
}

async function runManualRefresh() {
  if (!runtime.initialized) await initializeSharedPersistence();
  if (collectionModeFromUrl()) {
    if (!runtime.targetCampaignId || !runtime.initialized) throw new Error("collection_refresh_not_initialized");
    applyRxdbSnapshot(await fetchCollectionSnapshot(runtime.targetCampaignId));
    return;
  }
  const sync = runtime.sync;
  if (!runtime.initialized || !sync) throw new Error("rxdb_refresh_not_initialized");
  await sync.refreshAndWait();
  if (runtime.sync !== sync) throw new Error("rxdb_refresh_replaced");
  emit({ syncState: "server-confirmed", pendingCount: runtime.pendingWrites, messageCode: null });
}

export function manualRefreshCampaign() {
  setRefreshState("loading");
  emit({ syncState: "syncing", pendingCount: runtime.pendingWrites });
  void runManualRefresh()
    .then(() => setRefreshState("current", true))
    .catch((error) => {
      reportRxdbIssue({ kind: "network", code: error instanceof Error ? error.message : "campaign_refresh_failed" });
      setRefreshState("error", true);
    });
}

/** Completes the 900 ms campaign/team trailing window on explicit user commit. */
export function flushRxdbDrafts() {
  runtime.sync?.flushDebouncedWrites();
}

export function loadCampaignSnapshot(): CampaignLoadResult {
  if (typeof window === "undefined") return { snapshot: createInitialSnapshot(), warning: null };
  try {
    const primary = parseSnapshot(window.localStorage.getItem(localStorageKey(STORAGE_KEY)));
    const backup = parseSnapshot(window.localStorage.getItem(localStorageKey(BACKUP_STORAGE_KEY)));
    const legacy = parseSnapshot(window.localStorage.getItem(localStorageKey(LEGACY_STORAGE_KEY)));
    if (primary) { loadedExistingSnapshot = true; return { snapshot: primary, warning: null }; }
    if (backup) { loadedExistingSnapshot = true; return { snapshot: backup, warning: "Die lokale Hauptdatei war beschädigt. Eine lokale Sicherung wurde geladen." }; }
    if (legacy) { loadedExistingSnapshot = true; writeLocalSnapshot(legacy); return { snapshot: legacy, warning: null }; }
    loadedExistingSnapshot = false;
    return { snapshot: createInitialSnapshot(), warning: null };
  } catch {
    loadedExistingSnapshot = false;
    return { snapshot: createInitialSnapshot(), warning: "Lokale Daten konnten nicht gelesen werden." };
  }
}

export function saveCampaignSnapshot(snapshot: CampaignSnapshot) {
  const warning = writeLocalSnapshot(snapshot);
  if (typeof window === "undefined") return warning;
  startListeners();
  const previous = runtime.latestLocal;
  runtime.latestLocal = snapshot;
  if (!previous || previous.campaign.id !== snapshot.campaign.id) {
    runtime.initialized = false;
    runtime.targetCampaignId = snapshot.campaign.id;
    void initializeSharedPersistence();
    return warning;
  }
  let mutation: DurableCampaignMutation | null;
  try {
    mutation = deriveCampaignMutation(previous, snapshot);
  } catch (error) {
    if (error instanceof MutationDerivationError) {
      saveCampaignConflictSnapshot(snapshot);
      emit({ syncState: "failed", messageCode: "conflict" });
      return warning;
    }
    throw error;
  }
  if (!mutation) {
    if (!runtime.initialized) void initializeSharedPersistence();
    return warning;
  }
  runtime.pendingWrites += 1;
  emit({ syncState: navigator.onLine ? "local-saved" : "offline", pendingCount: runtime.pendingWrites });
  if (collectionModeFromUrl() && mutation.type.startsWith("collection.")) {
    saveChain = saveChain
      .then(async () => {
        await postCampaignMutation(snapshot.campaign.id, mutation, runtime.activeFieldGroupId);
        applyRxdbSnapshot(await fetchCollectionSnapshot(snapshot.campaign.id));
        emit({ syncState: "server-confirmed", pendingCount: runtime.pendingWrites, messageCode: null });
      })
      .catch((error) => {
        saveCampaignConflictSnapshot(snapshot);
        reportRxdbIssue({ kind: "network", code: error instanceof Error ? error.message : "collection_mutation_failed" });
      })
      .finally(() => {
        runtime.pendingWrites = Math.max(0, runtime.pendingWrites - 1);
        emit({ pendingCount: runtime.pendingWrites });
      });
    return warning;
  }
  saveChain = saveChain
    .then(async () => {
      if (!runtime.initialized) await initializeSharedPersistence();
      if (!runtime.sync) throw new Error("rxdb_not_initialized");
      if (mutation.type.startsWith("collection.")) {
        throw new Error("collection_mutation_requires_collection_mode");
      }
      await runtime.sync.applyMutation(mutation);
      emit({ syncState: navigator.onLine ? "waiting-server" : "offline", pendingCount: runtime.pendingWrites });
    })
    .catch((error) => {
      saveCampaignConflictSnapshot(snapshot);
      reportRxdbIssue({ kind: "network", code: error instanceof Error ? error.message : "rxdb_local_write_failed" });
    })
    .finally(() => {
      runtime.pendingWrites = Math.max(0, runtime.pendingWrites - 1);
      emit({ pendingCount: runtime.pendingWrites });
    });
  return warning;
}

export function saveCampaignConflictSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(localStorageKey(CONFLICT_STORAGE_KEY), JSON.stringify({ savedAt: new Date().toISOString(), snapshot }));
    return true;
  } catch {
    return false;
  }
}
