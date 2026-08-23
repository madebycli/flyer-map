import {
  createInitialSnapshot,
  type Area,
  type CampaignSnapshot,
  type PolygonGeometry,
  type Team,
} from "../domain/campaign";

const STORAGE_KEY = "verteil-flyer:m1:campaign-snapshot:v1";

export type CampaignLoadResult = {
  snapshot: CampaignSnapshot;
  warning: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPolygonGeometry(value: unknown): value is PolygonGeometry {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    return false;
  }

  const firstRing = value.coordinates[0];
  return (
    Array.isArray(firstRing) &&
    firstRing.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number",
    )
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

function isCampaignSnapshot(value: unknown): value is CampaignSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.revision !== "number") {
    return false;
  }

  const campaign = value.campaign;
  return (
    isRecord(campaign) &&
    typeof campaign.id === "string" &&
    typeof campaign.name === "string" &&
    (campaign.status === "draft" || campaign.status === "active" || campaign.status === "archived") &&
    typeof campaign.createdAt === "string" &&
    typeof campaign.updatedAt === "string" &&
    Array.isArray(value.teams) &&
    value.teams.every(isTeam) &&
    Array.isArray(value.areas) &&
    value.areas.every(isArea)
  );
}

export function loadCampaignSnapshot(): CampaignLoadResult {
  if (typeof window === "undefined") {
    return { snapshot: createInitialSnapshot(), warning: null };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { snapshot: createInitialSnapshot(), warning: null };

    const parsed: unknown = JSON.parse(raw);
    if (isCampaignSnapshot(parsed)) {
      return { snapshot: parsed, warning: null };
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
    return null;
  } catch {
    return "Lokales Speichern ist fehlgeschlagen. Bitte diese Seite noch nicht neu laden.";
  }
}
