import {
  CampaignApiError,
  accessTokenFromUrl,
  buildCampaignAccessUrl,
  campaignIdFromUrl,
  createCampaignSnapshot,
  fetchCampaignSnapshot,
  fetchCampaignVersion,
  fetchCurrentAccess,
  putCampaignSnapshot,
  redeemCampaignAccess,
  removeAccessTokenFromUrl,
  setCampaignIdInUrl,
  type AccessInfo,
} from "./campaignApi";
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

const STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const BACKUP_STORAGE_KEY = "verteil-flyer:campaign-snapshot:backup";
const CONFLICT_STORAGE_KEY = "verteil-flyer:campaign-snapshot:conflict";
const LEGACY_STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";
const POLL_INTERVAL_MS = 30_000;

export type CampaignLoadResult = {
  snapshot: CampaignSnapshot;
  warning: string | null;
};

export type RefreshState = "idle" | "loading" | "current" | "error" | "available";
export type SyncMessageCode = "access_required" | "network" | "conflict" | "forbidden" | null;

export type CampaignStoreUpdate = {
  snapshot?: CampaignSnapshot;
  access?: AccessInfo | null;
  refreshState?: RefreshState;
  messageCode?: SyncMessageCode;
  initialAccessUrl?: string;
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
  writeInFlight: boolean;
  pending: CampaignSnapshot | null;
  listenersStarted: boolean;
  interactionBlocked: boolean;
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
  writeInFlight: false,
  pending: null,
  listenersStarted: false,
  interactionBlocked: false,
};

const listeners = new Set<(update: CampaignStoreUpdate) => void>();
let loadedExistingSnapshot = false;
let refreshResetTimer: number | null = null;

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
    campaign: {
      ...snapshot.campaign,
      defaultMapView: null,
    },
  };
}

function migrateV1(snapshot: SnapshotV1): CampaignSnapshot {
  return migrateV2({
    ...snapshot,
    schemaVersion: 2,
    tasks: [],
  });
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

function writeLocalSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return null;
  const serialized = JSON.stringify(snapshot);

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    return "Lokales Speichern ist fehlgeschlagen. Bitte diese Seite noch nicht neu laden.";
  }

  try {
    window.localStorage.setItem(BACKUP_STORAGE_KEY, serialized);
  } catch {
    return "Gespeichert, aber die lokale Sicherheitskopie konnte nicht aktualisiert werden.";
  }
  return null;
}

function sameSnapshotContent(a: CampaignSnapshot, b: CampaignSnapshot) {
  return JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 });
}

function isNetworkLikeError(error: unknown) {
  return error instanceof CampaignApiError && (error.status === 0 || error.status === 503);
}

function isAccessError(error: unknown) {
  return error instanceof CampaignApiError && (error.status === 401 || error.code === "access_required");
}

function setAccess(access: AccessInfo | null) {
  syncRuntime.access = access;
  emit({ access, messageCode: access ? null : "access_required" });
}

function applyServerSnapshot(snapshot: CampaignSnapshot) {
  syncRuntime.latestLocal = snapshot;
  syncRuntime.lastServer = snapshot;
  syncRuntime.serverRevision = snapshot.revision;
  syncRuntime.remoteRevision = null;
  syncRuntime.pending = null;
  writeLocalSnapshot(snapshot);
  emit({ snapshot, messageCode: null });
}

async function recoverFromRejectedWrite(
  campaignId: string,
  optimisticSnapshot: CampaignSnapshot,
  error: unknown,
) {
  saveCampaignConflictSnapshot(optimisticSnapshot);

  if (isAccessError(error)) {
    syncRuntime.pending = optimisticSnapshot;
    syncRuntime.initialized = false;
    setAccess(null);
    return;
  }

  emit({ messageCode: error instanceof CampaignApiError && error.status === 403 ? "forbidden" : "conflict" });

  try {
    const serverSnapshot = await fetchCampaignSnapshot(campaignId);
    applyServerSnapshot(serverSnapshot);
  } catch (fetchError) {
    syncRuntime.pending = optimisticSnapshot;
    if (isNetworkLikeError(fetchError)) emit({ messageCode: "network" });
  }
}

async function flushSharedSnapshot() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.initialized ||
    syncRuntime.writeInFlight ||
    syncRuntime.serverRevision === null ||
    !syncRuntime.targetCampaignId ||
    syncRuntime.access?.role === "viewer"
  ) {
    return;
  }

  const candidate = syncRuntime.pending;
  if (!candidate || candidate.campaign.id !== syncRuntime.targetCampaignId) return;
  if (syncRuntime.lastServer && sameSnapshotContent(candidate, syncRuntime.lastServer)) {
    syncRuntime.pending = null;
    return;
  }

  syncRuntime.pending = null;
  syncRuntime.writeInFlight = true;
  const baseRevision = syncRuntime.serverRevision;
  const outgoing: CampaignSnapshot = { ...candidate, revision: baseRevision + 1 };

  try {
    const stored = await putCampaignSnapshot(syncRuntime.targetCampaignId, baseRevision, outgoing);
    syncRuntime.serverRevision = stored.revision;
    syncRuntime.lastServer = stored;
    syncRuntime.remoteRevision = null;

    if (syncRuntime.latestLocal === candidate) {
      syncRuntime.latestLocal = stored;
      writeLocalSnapshot(stored);
      emit({ snapshot: stored, messageCode: null });
    } else if (syncRuntime.latestLocal) {
      syncRuntime.pending = syncRuntime.latestLocal;
    }
  } catch (error) {
    if (isNetworkLikeError(error)) {
      syncRuntime.pending = candidate;
      emit({ messageCode: "network" });
    } else {
      await recoverFromRejectedWrite(syncRuntime.targetCampaignId, candidate, error);
    }
  } finally {
    syncRuntime.writeInFlight = false;
    if (syncRuntime.pending && navigator.onLine && syncRuntime.initialized) {
      queueMicrotask(() => void flushSharedSnapshot());
    }
  }
}

async function loadServerForAuthenticatedCampaign(targetCampaignId: string) {
  const serverSnapshot = await fetchCampaignSnapshot(targetCampaignId);
  const latestLocal = syncRuntime.latestLocal;

  syncRuntime.serverRevision = serverSnapshot.revision;
  syncRuntime.lastServer = serverSnapshot;
  syncRuntime.remoteRevision = null;
  syncRuntime.initialized = true;
  syncRuntime.pending = null;

  if (!latestLocal || latestLocal.campaign.id !== targetCampaignId) {
    if (latestLocal && loadedExistingSnapshot) saveCampaignConflictSnapshot(latestLocal);
    applyServerSnapshot(serverSnapshot);
    return;
  }

  if (syncRuntime.access?.role === "viewer") {
    if (!sameSnapshotContent(latestLocal, serverSnapshot) && loadedExistingSnapshot) {
      saveCampaignConflictSnapshot(latestLocal);
    }
    applyServerSnapshot(serverSnapshot);
    return;
  }

  if (latestLocal.revision > serverSnapshot.revision) {
    syncRuntime.pending = latestLocal;
    void flushSharedSnapshot();
    return;
  }

  const sameContent = sameSnapshotContent(latestLocal, serverSnapshot);
  if (latestLocal.revision === serverSnapshot.revision && !sameContent) {
    saveCampaignConflictSnapshot(latestLocal);
    emit({ messageCode: "conflict" });
    applyServerSnapshot(serverSnapshot);
    return;
  }

  if (serverSnapshot.revision > latestLocal.revision || !sameContent) {
    if (!sameContent && loadedExistingSnapshot) saveCampaignConflictSnapshot(latestLocal);
    applyServerSnapshot(serverSnapshot);
    return;
  }

  syncRuntime.latestLocal = serverSnapshot;
  writeLocalSnapshot(serverSnapshot);
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
        initialAccessUrl: buildCampaignAccessUrl(created.snapshot.campaign.id, created.initialAccessToken),
        messageCode: null,
      });
      return;
    }

    syncRuntime.initialized = false;
    setAccess(null);
  } catch (error) {
    syncRuntime.initialized = false;
    if (isNetworkLikeError(error)) emit({ messageCode: "network" });
    else if (isAccessError(error)) setAccess(null);
    else console.warn("campaign_sync_initialize_failed", error);
  } finally {
    syncRuntime.initializeInFlight = false;
  }
}

async function refreshFromServer(manual: boolean) {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.targetCampaignId ||
    syncRuntime.serverRevision === null ||
    syncRuntime.writeInFlight ||
    syncRuntime.pending
  ) {
    if (manual) setRefreshState("error", true);
    return;
  }

  if (manual) setRefreshState("loading");
  try {
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

    const serverSnapshot = await fetchCampaignSnapshot(syncRuntime.targetCampaignId);
    applyServerSnapshot(serverSnapshot);
    if (manual) setRefreshState("current", true);
    else setRefreshState("idle");
  } catch (error) {
    if (isAccessError(error)) {
      syncRuntime.initialized = false;
      setAccess(null);
    } else if (isNetworkLikeError(error)) {
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
    else if (syncRuntime.pending) void flushSharedSnapshot();
    else void refreshFromServer(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else void refreshFromServer(false);
  });

  window.setInterval(() => {
    if (syncRuntime.initialized) void refreshFromServer(false);
  }, POLL_INTERVAL_MS);
}

function queueSharedSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return;
  syncRuntime.latestLocal = snapshot;
  startSharedPersistenceRuntime();

  if (syncRuntime.lastServer && sameSnapshotContent(snapshot, syncRuntime.lastServer)) {
    syncRuntime.pending = null;
  } else {
    syncRuntime.pending = snapshot;
  }

  if (!syncRuntime.initialized) void initializeSharedPersistence();
  else if (syncRuntime.pending) void flushSharedSnapshot();
}

export function subscribeCampaignStore(listener: (update: CampaignStoreUpdate) => void) {
  listeners.add(listener);
  if (syncRuntime.access) listener({ access: syncRuntime.access });
  return () => listeners.delete(listener);
}

export function setCampaignInteractionBlocked(blocked: boolean) {
  syncRuntime.interactionBlocked = blocked;
  if (!blocked && syncRuntime.remoteRevision !== null && syncRuntime.serverRevision !== null) {
    if (syncRuntime.remoteRevision > syncRuntime.serverRevision && !syncRuntime.pending) {
      void refreshFromServer(false);
    }
  }
}

export function manualRefreshCampaign() {
  if (!syncRuntime.initialized) {
    setRefreshState("loading");
    void initializeSharedPersistence().finally(() => {
      setRefreshState(syncRuntime.initialized ? "current" : "error", true);
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
    const primaryRaw = window.localStorage.getItem(STORAGE_KEY);
    const backupRaw = window.localStorage.getItem(BACKUP_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);

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
      warning: "Lokale Daten konnten nicht gelesen werden. Änderungen bleiben bis zum Neuladen im Browser.",
    };
  }
}

export function saveCampaignSnapshot(snapshot: CampaignSnapshot) {
  const warning = writeLocalSnapshot(snapshot);
  if (!warning) queueSharedSnapshot(snapshot);
  return warning;
}

export function saveCampaignConflictSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      CONFLICT_STORAGE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), snapshot }),
    );
    return true;
  } catch {
    return false;
  }
}
