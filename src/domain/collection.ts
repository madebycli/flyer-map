import type { LineStringGeometry, LngLat, PolygonGeometry, TaskSourceProvenance } from "./campaign";
import {
  isPickupPosition,
  isPickupSource,
  type PickupTask,
} from "./pickup.ts";
import { deriveCollectionProgress } from "./collectionProgress.ts";
import type { RoadRange } from "./streetNetwork.ts";

export type CollectionAreaStatus =
  | "open"
  | "claimed"
  | "in-progress"
  | "completed"
  | "archived";

export type CollectionRunStatus = "active" | "closed" | "cancelled";

/** Pickup Area lifecycle is separate from legacy Collection Run ownership. */
export type PickupAreaState = "open" | "claimed" | "in-progress" | "completed" | "archived";
export type CollectionRoomStatus = "active" | "released" | "completed" | "force-released";
export type CollectionRoomParticipant = {
  id: string;
  roomId: string;
  collectorId: string;
  label: string;
  joinedAt: string;
  leftAt: string | null;
};
export type CollectionActor = {
  kind: "campaign-grant" | "collection-collector";
  ref: string | null;
};
export type CollectionRoom = {
  id: string;
  campaignId: string;
  areaId: string;
  status: CollectionRoomStatus;
  ownerCollectorId: string;
  ownerLabel: string;
  participants: CollectionRoomParticipant[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type CollectionRoadSectionStatus = "open" | "driven" | "later" | "unavailable";

export const PICKUP_COMPLETION_CONFIRMATION =
  "Ich habe alles eingetragen, was wir in diesem Gebiet erledigt haben.";

/**
 * A reviewed pickup section deliberately has its own identity and coverage.
 * Distribution Task ids are provenance only and never become pickup ids.
 */
export type CollectionRoadSection = {
  id: string;
  campaignId: string;
  areaId: string;
  label: string;
  geometry: LineStringGeometry;
  status: CollectionRoadSectionStatus;
  coverage: RoadRange[];
  sourceTaskId: string | null;
  sourceGeneration: string | null;
  source: TaskSourceProvenance | null;
  smartMarking: PickupSmartMarkingContext | null;
  /** Authoritative actor attribution is filled by D1 after a write. */
  createdBy?: CollectionActor;
  updatedBy?: CollectionActor;
  createdAt: string;
  updatedAt: string;
};

export type PickupSmartMarkingPoint = {
  point: LngLat;
  taskId: string;
  measure: number;
  distanceMeters: number;
};

/** Mirrors the current PR92 multi-point NetworkIntent contract. */
export type PickupSmartMarkingContext = {
  version: 1;
  intentId: string;
  generation: string;
  start: PickupSmartMarkingPoint;
  end: PickupSmartMarkingPoint;
  via: PickupSmartMarkingPoint[];
  selectedPath: string[];
  paths: string[][];
  expectedState: string;
  idempotencyKey: string;
  mutationIds: string[];
};

export type CollectionAreaProgress = {
  areaId: string;
  roadSectionsTotal: number;
  roadSectionsDriven: number;
  roadSectionsOpen: number;
  roadSectionsLater: number;
  roadSectionsUnavailable: number;
  pickupsTotal: number;
  pickupsCollected: number;
  updatedAt: string;
};

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
  /** Additive fields for the pickup action. Legacy Collection remains valid. */
  pickupState?: PickupAreaState;
  roomId?: string | null;
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
  pickups?: PickupTask[];
  rooms?: CollectionRoom[];
  roadSections?: CollectionRoadSection[];
  progress?: CollectionAreaProgress[];
};

export type NormalizedCollectionSnapshot = Omit<CollectionSnapshot, "pickups" | "rooms" | "roadSections" | "progress"> & {
  pickups: PickupTask[];
  rooms: CollectionRoom[];
  roadSections: CollectionRoadSection[];
  progress: CollectionAreaProgress[];
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

export function createEmptyCollectionSnapshot(): NormalizedCollectionSnapshot {
  return { mainArea: null, areas: [], runs: [], pickups: [], rooms: [], roadSections: [], progress: [] };
}

export function collectionSnapshotOrEmpty(
  value: CollectionSnapshot | undefined | null,
): NormalizedCollectionSnapshot {
  if (!value) return createEmptyCollectionSnapshot();
  const pickups = Array.isArray(value.pickups) ? value.pickups : [];
  const rooms = Array.isArray(value.rooms) ? value.rooms : [];
  const roadSections = Array.isArray(value.roadSections) ? value.roadSections : [];
  return {
    ...value,
    pickups,
    rooms,
    roadSections,
    progress: value.roadSections !== undefined || value.pickups !== undefined
      ? deriveCollectionProgress({ areas: value.areas, roadSections, pickups })
      : Array.isArray(value.progress) ? value.progress : [],
  };
}

export function createCollectionId(prefix: "main" | "area" | "run" | "member" | "pickup" | "room" | "participant" | "section" | "event") {
  return "collection_" + prefix + "_" + crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
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

function isLineString(value: unknown): value is LineStringGeometry {
  return isRecord(value) && value.type === "LineString" && Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 && value.coordinates.every(isLngLat);
}

function isRoomStatus(value: unknown): value is CollectionRoomStatus {
  return value === "active" || value === "released" || value === "completed" || value === "force-released";
}

function isSectionStatus(value: unknown): value is CollectionRoadSectionStatus {
  return value === "open" || value === "driven" || value === "later" || value === "unavailable";
}

function isRoadRange(value: unknown): value is { taskId: string; from: number; to: number } {
  return isRecord(value) && typeof value.taskId === "string" && value.taskId.length <= 200 &&
    typeof value.from === "number" && Number.isFinite(value.from) && value.from >= 0 &&
    typeof value.to === "number" && Number.isFinite(value.to) && value.to >= 0 && value.to >= value.from;
}

function isSmartPoint(value: unknown): value is PickupSmartMarkingPoint {
  return isRecord(value) && isLngLat(value.point) && typeof value.taskId === "string" &&
    value.taskId.length <= 200 && typeof value.measure === "number" && Number.isFinite(value.measure) &&
    value.measure >= 0 && typeof value.distanceMeters === "number" && Number.isFinite(value.distanceMeters) &&
    value.distanceMeters >= 0;
}

function isSmartMarking(value: unknown): value is PickupSmartMarkingContext {
  if (!isRecord(value) || value.version !== 1 || typeof value.intentId !== "string" ||
    typeof value.generation !== "string" || !isSmartPoint(value.start) || !isSmartPoint(value.end) ||
    !Array.isArray(value.via) || value.via.length > 30 || !value.via.every(isSmartPoint) ||
    !Array.isArray(value.selectedPath) || value.selectedPath.length === 0 ||
    !value.selectedPath.every((id) => typeof id === "string" && id.length <= 200) ||
    !Array.isArray(value.paths) || value.paths.length !== value.via.length + 1 ||
    !value.paths.every((path) => Array.isArray(path) && path.length > 0 && path.every((id) => typeof id === "string" && id.length <= 200)) ||
    JSON.stringify(value.paths.flat()) !== JSON.stringify(value.selectedPath) ||
    typeof value.expectedState !== "string" || !/^[a-f0-9]{64}$/u.test(value.expectedState) ||
    typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 1 || value.idempotencyKey.length > 200 ||
    !Array.isArray(value.mutationIds) || value.mutationIds.length > 100 ||
    !value.mutationIds.every((id) => typeof id === "string" && id.length <= 200)) return false;
  return true;
}

export function isPickupSmartMarkingContext(value: unknown): value is PickupSmartMarkingContext {
  return isSmartMarking(value);
}

function isRoom(value: unknown, areaIds: Set<string>): value is CollectionRoom {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.campaignId !== "string" ||
    typeof value.areaId !== "string" || !areaIds.has(value.areaId) || !isRoomStatus(value.status) ||
    typeof value.ownerCollectorId !== "string" || typeof value.ownerLabel !== "string" ||
    !Array.isArray(value.participants) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    (value.closedAt !== null && typeof value.closedAt !== "string")) return false;
  const participantIds = new Set<string>();
  for (const member of value.participants) {
    if (!isRecord(member) || typeof member.id !== "string" || participantIds.has(member.id) ||
      member.roomId !== value.id || typeof member.collectorId !== "string" || typeof member.label !== "string" ||
      !isTimestamp(member.joinedAt) || (member.leftAt !== null && typeof member.leftAt !== "string")) return false;
    participantIds.add(member.id);
  }
  return true;
}

function isAreaProgress(value: unknown, areaIds: Set<string>): value is CollectionAreaProgress {
  if (!isRecord(value) || typeof value.areaId !== "string" || !areaIds.has(value.areaId) ||
    !isTimestamp(value.updatedAt)) return false;
  return ["roadSectionsTotal", "roadSectionsDriven", "roadSectionsOpen", "roadSectionsLater", "roadSectionsUnavailable", "pickupsTotal", "pickupsCollected"]
    .every((key) => typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= 0);
}

function isStatus(value: unknown): value is CollectionAreaStatus {
  return value === "open" || value === "claimed" || value === "in-progress" ||
    value === "completed" || value === "archived";
}

function isRunStatus(value: unknown): value is CollectionRunStatus {
  return value === "active" || value === "closed" || value === "cancelled";
}

function isPickupStatus(value: unknown) {
  return value === "open" || value === "collected" || value === "unavailable" || value === "needs-follow-up";
}

function isPickupActor(value: unknown) {
  return (
    isRecord(value) &&
    (value.kind === "campaign-grant" || value.kind === "collection-collector") &&
    (value.ref === null || typeof value.ref === "string")
  );
}

export function isCollectionSnapshot(value: unknown): value is CollectionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.areas) || !Array.isArray(value.runs)) return false;
  if (value.pickups !== undefined && !Array.isArray(value.pickups)) return false;
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
      typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string" ||
      (candidate.pickupState !== undefined && !isStatus(candidate.pickupState)) ||
      (candidate.roomId !== undefined && candidate.roomId !== null && typeof candidate.roomId !== "string")) return false;
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

  const pickupIds = new Set<string>();
  for (const candidate of (value.pickups ?? []) as unknown[]) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      pickupIds.has(candidate.id) ||
      typeof candidate.campaignId !== "string" ||
      (candidate.areaId !== null && (typeof candidate.areaId !== "string" || !areaIds.has(candidate.areaId))) ||
      typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 160 ||
      typeof candidate.address !== "string" || candidate.address.trim().length < 1 || candidate.address.length > 320 ||
      typeof candidate.description !== "string" || candidate.description.length > 4_000 ||
      !isPickupPosition(candidate.position) ||
      !isPickupStatus(candidate.status) ||
      (candidate.archivedAt !== null && typeof candidate.archivedAt !== "string") ||
      !Array.isArray(candidate.assignedRunIds) ||
      !candidate.assignedRunIds.every((id) => typeof id === "string" && runIds.has(id)) ||
      new Set(candidate.assignedRunIds).size !== candidate.assignedRunIds.length ||
      !Array.isArray(candidate.assignedCollectorIds) ||
      !candidate.assignedCollectorIds.every((id) => typeof id === "string") ||
      new Set(candidate.assignedCollectorIds).size !== candidate.assignedCollectorIds.length ||
      !isPickupSource(candidate.source) ||
      !isPickupActor(candidate.createdBy) ||
      !isPickupActor(candidate.updatedBy) ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.updatedAt !== "string"
    ) {
      return false;
    }
    pickupIds.add(candidate.id);
  }

  const sectionIds = new Set<string>();
  for (const candidate of (value.roadSections ?? []) as unknown[]) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || sectionIds.has(candidate.id) ||
      typeof candidate.campaignId !== "string" || typeof candidate.areaId !== "string" || !areaIds.has(candidate.areaId) ||
      typeof candidate.label !== "string" || !isLineString(candidate.geometry) || !isSectionStatus(candidate.status) ||
      !Array.isArray(candidate.coverage) || !candidate.coverage.every(isRoadRange) ||
      (candidate.sourceTaskId !== null && typeof candidate.sourceTaskId !== "string") ||
      (candidate.sourceGeneration !== null && typeof candidate.sourceGeneration !== "string") ||
      !isPickupSource(candidate.source) ||
      (candidate.smartMarking !== null && !isSmartMarking(candidate.smartMarking)) ||
      (candidate.createdBy !== undefined && !isPickupActor(candidate.createdBy)) ||
      (candidate.updatedBy !== undefined && !isPickupActor(candidate.updatedBy)) ||
      !isTimestamp(candidate.createdAt) || !isTimestamp(candidate.updatedAt)) return false;
    sectionIds.add(candidate.id);
  }

  const roomIds = new Set<string>();
  for (const candidate of (value.rooms ?? []) as unknown[]) {
    if (!isRoom(candidate, areaIds) || roomIds.has(candidate.id)) return false;
    roomIds.add(candidate.id);
  }
  for (const candidate of (value.progress ?? []) as unknown[]) {
    if (!isAreaProgress(candidate, areaIds)) return false;
  }
  return true;
}

export function collectionAreaColor(index: number) {
  return COLLECTION_AREA_COLORS[index % COLLECTION_AREA_COLORS.length];
}
