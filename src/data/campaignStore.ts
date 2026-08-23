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
const LEGACY_STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";

export type CampaignLoadResult = {
  snapshot: CampaignSnapshot;
  warning: string | null;
};

type LegacySnapshotV1 = Omit<CampaignSnapshot, "schemaVersion" | "tasks"> & {
  schemaVersion: 1;
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

export function loadCampaignSnapshot(): CampaignLoadResult {
  if (typeof window === "undefined") {
    return { snapshot: createInitialSnapshot(), warning: null };
  }

  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { snapshot: createInitialSnapshot(), warning: null };

    const parsed: unknown = JSON.parse(raw);
    if (isCampaignSnapshot(parsed)) {
      return { snapshot: parsed, warning: null };
    }

    if (isLegacySnapshotV1(parsed)) {
      return { snapshot: migrateV1(parsed), warning: null };
    }

    return {
      snapshot: createInitialSnapshot(),
      warning: "Die lokal gespeicherten Daten waren ungültig und wurden nicht geladen.",
    };
  } catch {
    return {
      snapshot: createInitialSnapshot(),
      warning: "Lokale Daten konnten nicht gelesen werden. Änderungen bleiben bis zum Neuladen im Browser.",
    };
  }
}

export function saveCampaignSnapshot(snapshot: CampaignSnapshot) {
  if (typeof window === "undefined") return null;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return null;
  } catch {
    return "Lokales Speichern ist fehlgeschlagen. Bitte diese Seite noch nicht neu laden.";
  }
}
