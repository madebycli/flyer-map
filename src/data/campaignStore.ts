import {
  CampaignApiError,
  campaignIdFromUrl,
  fetchCampaignSnapshot,
  fetchCampaignVersion,
  putCampaignSnapshot,
  setCampaignIdInUrl,
} from "./campaignApi";
import {
  createInitialSnapshot,
  type Area,
  type CampaignSnapshot,
  type DistributionTask,
  type LineStringGeometry,
  type PolygonGeometry,
  type Team,
} from "../domain/campaign";

const STORAGE_KEY = "verteil-flyer:campaign-snapshot";
const BACKUP_STORAGE_KEY = "verteil-flyer:campaign-snapshot:backup";
const CONFLICT_STORAGE_KEY = "verteil-flyer:campaign-snapshot:conflict";
const LEGACY_STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";
const POLL_INTERVAL_MS = 5_000;

export type CampaignLoadResult = {
  snapshot: CampaignSnapshot;
  warning: string | null;
};

type LegacySnapshotV1 = Omit<CampaignSnapshot, "schemaVersion" | "tasks"> & {
  schemaVersion: 1;
};

type SyncRuntime = {
  targetCampaignId: string | null;
  latestLocal: CampaignSnapshot | null;
  lastServer: CampaignSnapshot | null;
  serverRevision: number | null;
  initialized: boolean;
  initializeInFlight: boolean;
  writeInFlight: boolean;
  pending: CampaignSnapshot | null;
  listenersStarted: boolean;
  pollTimer: number | null;
};

const syncRuntime: SyncRuntime = {
  targetCampaignId: null,
  latestLocal: null,
  lastServer: null,
  serverRevision: null,
  initialized: false,
  initializeInFlight: false,
  writeInFlight: false,
  pending: null,
  listenersStarted: false,
  pollTimer: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLngLat(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
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

function hasValidCampaign(value: Record<string, unknown>) {
  const campaign = value.campaign;
  return (
    isRecord(campaign) &&
    typeof campaign.id === "string" &&
    typeof campaign.name === "string" &&
    (campaign.status === "draft" || campaign.status === "active" || campaign.status === "archived") &&
    typeof campaign.createdAt === "string" &&
    typeof campaign.updatedAt === "string"
  );
}

function hasValidBaseCollections(value: Record<string, unknown>) {
  return (
    typeof value.revision === "number" &&
    hasValidCampaign(value) &&
    Array.isArray(value.teams) &&
    value.teams.every(isTeam) &&
    Array.isArray(value.areas) &&
    value.areas.every(isArea)
  );
}

function isCampaignSnapshot(value: unknown): value is CampaignSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    hasValidBaseCollections(value) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isDistributionTask)
  );
}

function isLegacySnapshotV1(value: unknown): value is LegacySnapshotV1 {
  return isRecord(value) && value.schemaVersion === 1 && hasValidBaseCollections(value);
}

function migrateV1(snapshot: LegacySnapshotV1): CampaignSnapshot {
  return {
    ...snapshot,
    schemaVersion: 2,
    tasks: [],
  };
}

function parseSnapshot(raw: string | null): CampaignSnapshot | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCampaignSnapshot(parsed)) return parsed;
    if (isLegacySnapshotV1(parsed)) return migrateV1(parsed);
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

function informUser(message: string) {
  if (typeof window !== "undefined") window.alert(message);
}

function replaceLocalWithServer(snapshot: CampaignSnapshot) {
  writeLocalSnapshot(snapshot);
  if (typeof window !== "undefined") window.location.reload();
}

async function recoverFromRejectedWrite(
  campaignId: string,
  optimisticSnapshot: CampaignSnapshot,
  error: unknown,
) {
  const preserved = saveCampaignConflictSnapshot(optimisticSnapshot);
  const reason =
    error instanceof CampaignApiError && error.code === "revision_conflict"
      ? "Ein anderes Gerät hat diese Campaign inzwischen geändert."
      : error instanceof CampaignApiError
        ? error.message
        : "Der Server hat die Änderung abgelehnt.";

  informUser(
    `Synchronisierungskonflikt: ${reason}${
      preserved ? " Deine lokale Version wurde als Sicherheitskopie in diesem Browser behalten." : ""
    } Der aktuelle Serverstand wird neu geladen.`,
  );

  try {
    const serverSnapshot = await fetchCampaignSnapshot(campaignId);
    syncRuntime.serverRevision = serverSnapshot.revision;
    syncRuntime.lastServer = serverSnapshot;
    syncRuntime.pending = null;
    replaceLocalWithServer(serverSnapshot);
  } catch {
    syncRuntime.pending = optimisticSnapshot;
    informUser("Der Serverstand konnte noch nicht neu geladen werden. Dein lokaler Stand bleibt auf diesem Gerät erhalten.");
  }
}

async function flushSharedSnapshot() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.initialized ||
    syncRuntime.writeInFlight ||
    syncRuntime.serverRevision === null ||
    !syncRuntime.targetCampaignId
  ) {
    return;
  }

  const candidate = syncRuntime.pending;
  if (!candidate || candidate.campaign.id !== syncRuntime.targetCampaignId) return;

  syncRuntime.pending = null;
  syncRuntime.writeInFlight = true;
  const baseRevision = syncRuntime.serverRevision;
  const outgoing: CampaignSnapshot = {
    ...candidate,
    revision: baseRevision + 1,
  };

  try {
    const stored = await putCampaignSnapshot(
      syncRuntime.targetCampaignId,
      baseRevision,
      outgoing,
    );
    syncRuntime.serverRevision = stored.revision;
    syncRuntime.lastServer = stored;
    writeLocalSnapshot(stored);

    if (syncRuntime.latestLocal !== candidate && syncRuntime.latestLocal) {
      syncRuntime.pending = syncRuntime.latestLocal;
    }
  } catch (error) {
    if (isNetworkLikeError(error)) {
      syncRuntime.pending = candidate;
    } else {
      await recoverFromRejectedWrite(syncRuntime.targetCampaignId, candidate, error);
    }
  } finally {
    syncRuntime.writeInFlight = false;
    if (syncRuntime.pending && navigator.onLine) {
      queueMicrotask(() => void flushSharedSnapshot());
    }
  }
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
    let serverSnapshot: CampaignSnapshot;
    try {
      serverSnapshot = await fetchCampaignSnapshot(targetCampaignId);
    } catch (error) {
      if (
        error instanceof CampaignApiError &&
        error.status === 404 &&
        (!urlCampaignId || urlCampaignId === syncRuntime.latestLocal.campaign.id)
      ) {
        const candidate = syncRuntime.latestLocal;
        const stored = await putCampaignSnapshot(targetCampaignId, null, candidate);
        syncRuntime.serverRevision = stored.revision;
        syncRuntime.lastServer = stored;
        syncRuntime.initialized = true;
        writeLocalSnapshot(stored);
        if (syncRuntime.latestLocal !== candidate) syncRuntime.pending = syncRuntime.latestLocal;
        if (syncRuntime.pending) void flushSharedSnapshot();
        return;
      }
      throw error;
    }

    const latestLocal = syncRuntime.latestLocal;
    if (latestLocal.campaign.id !== targetCampaignId) {
      saveCampaignConflictSnapshot(latestLocal);
      informUser("Diese URL öffnet eine andere gemeinsame Campaign. Dein bisheriger lokaler Stand wurde als Sicherheitskopie behalten.");
      replaceLocalWithServer(serverSnapshot);
      return;
    }

    syncRuntime.serverRevision = serverSnapshot.revision;
    syncRuntime.lastServer = serverSnapshot;
    syncRuntime.initialized = true;

    if (latestLocal.revision > serverSnapshot.revision) {
      syncRuntime.pending = latestLocal;
      void flushSharedSnapshot();
      return;
    }

    const sameContent = sameSnapshotContent(latestLocal, serverSnapshot);
    if (latestLocal.revision === serverSnapshot.revision && !sameContent) {
      saveCampaignConflictSnapshot(latestLocal);
      informUser("Lokaler und gemeinsamer Stand haben dieselbe Revision, unterscheiden sich aber. Die lokale Version wurde gesichert; der Serverstand wird geladen.");
      replaceLocalWithServer(serverSnapshot);
      return;
    }

    if (serverSnapshot.revision > latestLocal.revision || !sameContent) {
      if (!sameContent) saveCampaignConflictSnapshot(latestLocal);
      replaceLocalWithServer(serverSnapshot);
      return;
    }

    syncRuntime.pending = null;
    writeLocalSnapshot(serverSnapshot);
  } catch (error) {
    if (!isNetworkLikeError(error)) {
      if (error instanceof CampaignApiError && error.status === 404) {
        informUser("Die Campaign aus diesem Link wurde auf dem Server nicht gefunden. Deine lokalen Daten wurden nicht überschrieben.");
      } else {
        informUser(
          error instanceof CampaignApiError
            ? `Gemeinsame Synchronisierung fehlgeschlagen: ${error.message}`
            : "Gemeinsame Synchronisierung ist unerwartet fehlgeschlagen.",
        );
      }
    }
  } finally {
    syncRuntime.initializeInFlight = false;
  }
}

async function pollSharedVersion() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    !syncRuntime.initialized ||
    syncRuntime.writeInFlight ||
    syncRuntime.pending ||
    syncRuntime.serverRevision === null ||
    !syncRuntime.targetCampaignId
  ) {
    return;
  }

  try {
    const revision = await fetchCampaignVersion(syncRuntime.targetCampaignId);
    if (revision === syncRuntime.serverRevision) return;

    const serverSnapshot = await fetchCampaignSnapshot(syncRuntime.targetCampaignId);
    syncRuntime.serverRevision = serverSnapshot.revision;
    syncRuntime.lastServer = serverSnapshot;
    replaceLocalWithServer(serverSnapshot);
  } catch (error) {
    if (!isNetworkLikeError(error)) {
      console.warn("campaign_version_poll_failed", error);
    }
  }
}

function startSharedPersistenceRuntime() {
  if (typeof window === "undefined" || syncRuntime.listenersStarted) return;
  syncRuntime.listenersStarted = true;

  window.addEventListener("online", () => {
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else if (syncRuntime.pending) void flushSharedSnapshot();
    else void pollSharedVersion();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else void pollSharedVersion();
  });

  syncRuntime.pollTimer = window.setInterval(() => {
    if (!syncRuntime.initialized) void initializeSharedPersistence();
    else void pollSharedVersion();
  }, POLL_INTERVAL_MS);
}

function queueSharedSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return;
  syncRuntime.latestLocal = snapshot;
  syncRuntime.pending = snapshot;
  startSharedPersistenceRuntime();

  if (!syncRuntime.initialized) void initializeSharedPersistence();
  else void flushSharedSnapshot();
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
    if (primary) return { snapshot: primary, warning: null };

    const backup = parseSnapshot(backupRaw);
    if (backup) {
      return {
        snapshot: backup,
        warning: primaryRaw
          ? "Die lokale Hauptdatei war beschädigt. Eine lokale Sicherung wurde geladen."
          : null,
      };
    }

    const legacy = parseSnapshot(legacyRaw);
    if (legacy) {
      writeLocalSnapshot(legacy);
      return { snapshot: legacy, warning: null };
    }

    if (primaryRaw || backupRaw || legacyRaw) {
      return {
        snapshot: createInitialSnapshot(),
        warning: "Lokale Daten konnten nicht wiederhergestellt werden.",
      };
    }

    return { snapshot: createInitialSnapshot(), warning: null };
  } catch {
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
