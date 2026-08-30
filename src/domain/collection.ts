import type { LngLat, PolygonGeometry } from "./campaign";

export type CollectionAreaStatus =
  | "open"
  | "claimed"
  | "in-progress"
  | "completed"
  | "archived";

export type CollectionRunStatus = "active" | "closed" | "cancelled";

export type CollectionMainArea = {
  id: string;
  campaignId: string;
  name: string;
  geometry: PolygonGeometry;
  createdAt: string;
  updatedAt: string;
};

export type CollectionArea = {
  id: string;
  campaignId: string;
  mainAreaId: string;
  name: string;
  geometry: PolygonGeometry;
  color: string;
  status: CollectionAreaStatus;
  runId: string | null;
  claimedByCollectorId: string | null;
  claimedByLabel: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollectionRunMember = {
  id: string;
  runId: string;
  collectorId: string;
  label: string;
  joinedAt: string;
  leftAt: string | null;
};

export type CollectionRun = {
  id: string;
  campaignId: string;
  mainAreaId: string;
  status: CollectionRunStatus;
  startedAt: string;
  endedAt: string | null;
  createdByCollectorId: string;
  areaIds: string[];
  members: CollectionRunMember[];
  createdAt: string;
  updatedAt: string;
};

export type CollectionSnapshot = {
  mainArea: CollectionMainArea | null;
  areas: CollectionArea[];
  runs: CollectionRun[];
};

export const COLLECTION_AREA_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ca8a04",
  "#0891b2",
  "#ea580c",
  "#db2777",
] as const;

export const COLLECTION_AREA_STATUS_COLORS: Record<CollectionAreaStatus, string> = {
  open: "#64748b",
  claimed: "#2563eb",
  "in-progress": "#ca8a04",
  completed: "#16a34a",
  archived: "#94a3b8",
};

export function createEmptyCollectionSnapshot(): CollectionSnapshot {
  return { mainArea: null, areas: [], runs: [] };
}

export function collectionSnapshotOrEmpty(value: CollectionSnapshot | undefined | null) {
  return value ?? createEmptyCollectionSnapshot();
}

export function createCollectionId(prefix: "main" | "area" | "run" | "member") {
  return "collection_" + prefix + "_" + crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isPolygon(value: unknown): value is PolygonGeometry {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) return false;
  return value.coordinates.length === 1 && Array.isArray(value.coordinates[0]) &&
    value.coordinates[0].length >= 4 && value.coordinates[0].every(isLngLat);
}

function isStatus(value: unknown): value is CollectionAreaStatus {
  return value === "open" || value === "claimed" || value === "in-progress" ||
    value === "completed" || value === "archived";
}

function isRunStatus(value: unknown): value is CollectionRunStatus {
  return value === "active" || value === "closed" || value === "cancelled";
}

export function isCollectionSnapshot(value: unknown): value is CollectionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.areas) || !Array.isArray(value.runs)) return false;
  if (value.mainArea !== null && value.mainArea !== undefined) {
    const main = value.mainArea;
    if (!isRecord(main) || typeof main.id !== "string" || typeof main.campaignId !== "string" ||
      typeof main.name !== "string" || !isPolygon(main.geometry) ||
      typeof main.createdAt !== "string" || typeof main.updatedAt !== "string") return false;
  }
  const areaIds = new Set<string>();
  for (const candidate of value.areas) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || areaIds.has(candidate.id) ||
      typeof candidate.campaignId !== "string" || typeof candidate.mainAreaId !== "string" ||
      typeof candidate.name !== "string" || !isPolygon(candidate.geometry) ||
      typeof candidate.color !== "string" || !isStatus(candidate.status) ||
      (candidate.runId !== null && typeof candidate.runId !== "string") ||
      (candidate.claimedByCollectorId !== null && typeof candidate.claimedByCollectorId !== "string") ||
      (candidate.claimedByLabel !== null && typeof candidate.claimedByLabel !== "string") ||
      (candidate.completedAt !== null && typeof candidate.completedAt !== "string") ||
      typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") return false;
    areaIds.add(candidate.id);
  }
  const runIds = new Set<string>();
  for (const candidate of value.runs) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || runIds.has(candidate.id) ||
      typeof candidate.campaignId !== "string" || typeof candidate.mainAreaId !== "string" ||
      !isRunStatus(candidate.status) || typeof candidate.startedAt !== "string" ||
      (candidate.endedAt !== null && typeof candidate.endedAt !== "string") ||
      typeof candidate.createdByCollectorId !== "string" || !Array.isArray(candidate.areaIds) ||
      !candidate.areaIds.every((id) => typeof id === "string") || !Array.isArray(candidate.members)) return false;
    const memberIds = new Set<string>();
    for (const member of candidate.members) {
      if (!isRecord(member) || typeof member.id !== "string" || memberIds.has(member.id) ||
        member.runId !== candidate.id || typeof member.collectorId !== "string" ||
        typeof member.label !== "string" || typeof member.joinedAt !== "string" ||
        (member.leftAt !== null && typeof member.leftAt !== "string")) return false;
      memberIds.add(member.id);
    }
    runIds.add(candidate.id);
  }
  return true;
}

export function collectionAreaColor(index: number) {
  return COLLECTION_AREA_COLORS[index % COLLECTION_AREA_COLORS.length];
}
