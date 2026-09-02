import type {
  Area,
  CampaignSnapshot,
  DistributionTask,
  HouseTask,
  PolygonGeometry,
} from "../src/domain/campaign.ts";
import {
  pointInOrOnPolygon,
  polygonRepresentativePoint,
} from "../src/domain/areaTaskPreparation.ts";
import { validatePolygonVertices } from "../src/domain/geometry.ts";
import { createSmartHouseTaskSnapshot } from "../src/domain/smartHouseTask.ts";
import { toSmartBuildingCandidate } from "../src/domain/smartCandidates.ts";
import {
  hasAreaTaskPreparationSchema,
  loadCampaignSnapshot,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "./campaignRepository.ts";
import {
  fetchOsmFeaturesForArea,
  OsmFeaturesForAreaError,
  type FetchLike,
  type OsmFeaturesForAreaLimits,
} from "./offlineMap.ts";
import {
  prepareStreetsForArea,
  STREET_ENGINE_ALGORITHM_VERSION,
  StreetPreparationLimitError,
} from "./streetPreparation/engine.ts";
import type {
  StreetPreparationDiagnostics,
  StreetPreparationSourceMetrics,
} from "./streetPreparation/types.ts";
import {
  materializePreparedStreetTasks,
  reconcilePreparedStreetTasks,
} from "./streetPreparation/reconcilePreparedStreetTasks.ts";

export const AREA_PREPARATION_PENDING_FRESH_MS = 60_000;
export const AREA_STREET_PREPARATION_ALGORITHM_VERSION = STREET_ENGINE_ALGORITHM_VERSION;
export const AREA_PREPARATION_MAX_ROAD_FRAGMENTS = 2_000;
export const AREA_PREPARATION_MAX_BUILDINGS = 10_000;
export const AREA_PREPARATION_CHUNK_BYTES = 450_000;
/** D1 batches are bounded; reserve room for claim, deletes and ready state. */
export const AREA_PREPARATION_MAX_INSERT_CHUNKS = 90;

export type AreaPreparationFailureCode =
  | "area_preparation_schema_unavailable"
  | "area_preparation_too_large"
  | "area_preparation_osm_timeout"
  | "area_preparation_osm_failed"
  | "area_preparation_osm_invalid"
  | "area_preparation_osm_rate_limited"
  | "area_preparation_osm_server_error"
  | "area_preparation_osm_response_too_large"
  | "area_preparation_building_volume"
  | "area_preparation_too_many_features"
  | "area_preparation_work_started"
  | "area_preparation_publish_failed"
  | "area_preparation_stale";

export type AreaPreparationPhaseStatus = "pending" | "ready" | "failed";
export type AreaPreparationStateStatus = AreaPreparationPhaseStatus;

export type AreaPreparationState = {
  campaignId: string;
  areaId: string;
  geometryHash: string;
  generation: string;
  status: AreaPreparationStateStatus;
  streetStatus: AreaPreparationPhaseStatus;
  houseStatus: AreaPreparationPhaseStatus;
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  streetSourceTimestamp: string | null;
  houseSourceTimestamp: string | null;
  startedAt: string | null;
  readyAt: string | null;
  failedAt: string | null;
  streetStartedAt: string | null;
  houseStartedAt: string | null;
  streetReadyAt: string | null;
  houseReadyAt: string | null;
  streetFailedAt: string | null;
  houseFailedAt: string | null;
  lastErrorCode: AreaPreparationFailureCode | null;
  streetErrorCode: AreaPreparationFailureCode | null;
  houseErrorCode: AreaPreparationFailureCode | null;
  updatedAt: string;
};

export type AreaPreparationPublicState = {
  status: "missing" | AreaPreparationStateStatus;
  streetStatus: "missing" | AreaPreparationPhaseStatus;
  houseStatus: "missing" | AreaPreparationPhaseStatus;
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  errorCode: AreaPreparationFailureCode | null;
  streetErrorCode: AreaPreparationFailureCode | null;
  houseErrorCode: AreaPreparationFailureCode | null;
  actionRequired: boolean;
  updatedAt: string | null;
};

export type PrepareAreaTasksResult =
  | { outcome: "ready"; roadCount: number; houseCount: number; generation: string }
  | { outcome: "no-op"; state: "ready" | "pending" }
  | { outcome: "failed"; code: AreaPreparationFailureCode }
  | { outcome: "stale"; code: "area_preparation_stale" }
  | { outcome: "missing" };

export type AreaTaskPreparationOptions = {
  upstreamUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  randomUUID?: () => string;
  limits?: OsmFeaturesForAreaLimits;
  maxRoadFragments?: number;
  maxBuildings?: number;
  chunkBytes?: number;
  onStreetDiagnostics?: (diagnostics: StreetPreparationDiagnostics) => void;
};

/** A claimed, server-owned run whose pending state is already durable in D1. */
export type AreaTaskPreparationRun = {
  campaignId: string;
  areaId: string;
  snapshot: CampaignSnapshot;
  area: Area;
  geometryHash: string;
  generation: string;
  phases: Array<"street" | "house">;
  now: string;
};

/** Minimal Cloudflare boundary used by Worker route code only. */
export type AreaPreparationExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type AreaPreparationRow = {
  campaign_id: string;
  area_id: string;
  geometry_hash: string;
  generation: string;
  status: AreaPreparationStateStatus;
  road_count: number;
  house_count: number;
  source_timestamp: string | null;
  started_at: string | null;
  ready_at: string | null;
  failed_at: string | null;
  last_error_code: AreaPreparationFailureCode | null;
  updated_at: string;
  street_status: AreaPreparationPhaseStatus;
  house_status: AreaPreparationPhaseStatus;
  street_source_timestamp: string | null;
  house_source_timestamp: string | null;
  street_started_at: string | null;
  house_started_at: string | null;
  street_ready_at: string | null;
  house_ready_at: string | null;
  street_failed_at: string | null;
  house_failed_at: string | null;
  street_error_code: AreaPreparationFailureCode | null;
  house_error_code: AreaPreparationFailureCode | null;
};

class PreparationFailure extends Error {
  readonly code: AreaPreparationFailureCode;

  constructor(code: AreaPreparationFailureCode, message: string) {
    super(message);
    this.name = "PreparationFailure";
    this.code = code;
  }
}

function aggregatePreparationStatus(
  streetStatus: AreaPreparationPhaseStatus,
  houseStatus: AreaPreparationPhaseStatus,
): AreaPreparationStateStatus {
  if (streetStatus === "failed") return "failed";
  if (streetStatus === "pending" || houseStatus === "pending") return "pending";
  if (streetStatus === "ready") return "ready";
  return "failed";
}

function isActionRequiredState(state: AreaPreparationState | null) {
  return Boolean(
    state?.streetErrorCode === "area_preparation_work_started" ||
    state?.houseErrorCode === "area_preparation_work_started" ||
    state?.lastErrorCode === "area_preparation_work_started",
  );
}

function latestTimestamp(values: Array<string | null>) {
  return values
    .filter((value): value is string => value !== null)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
}

function toState(row: AreaPreparationRow): AreaPreparationState {
  return {
    campaignId: row.campaign_id,
    areaId: row.area_id,
    geometryHash: row.geometry_hash,
    generation: row.generation,
    status: aggregatePreparationStatus(row.street_status, row.house_status),
    streetStatus: row.street_status,
    houseStatus: row.house_status,
    roadCount: row.road_count,
    houseCount: row.house_count,
    sourceTimestamp: row.source_timestamp,
    streetSourceTimestamp: row.street_source_timestamp,
    houseSourceTimestamp: row.house_source_timestamp,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    failedAt: row.failed_at,
    streetStartedAt: row.street_started_at,
    houseStartedAt: row.house_started_at,
    streetReadyAt: row.street_ready_at,
    houseReadyAt: row.house_ready_at,
    streetFailedAt: row.street_failed_at,
    houseFailedAt: row.house_failed_at,
    lastErrorCode: row.last_error_code,
    streetErrorCode: row.street_error_code,
    houseErrorCode: row.house_error_code,
    updatedAt: row.updated_at,
  };
}

function publicState(state: AreaPreparationState | null): AreaPreparationPublicState {
  if (!state) {
    return {
      status: "missing",
      streetStatus: "missing",
      houseStatus: "missing",
      roadCount: 0,
      houseCount: 0,
      sourceTimestamp: null,
      errorCode: null,
      streetErrorCode: null,
      houseErrorCode: null,
      actionRequired: false,
      updatedAt: null,
    };
  }
  const streetErrorCode = state.streetErrorCode;
  const houseErrorCode = state.houseErrorCode;
  return {
    status: aggregatePreparationStatus(state.streetStatus, state.houseStatus),
    streetStatus: state.streetStatus,
    houseStatus: state.houseStatus,
    roadCount: state.roadCount,
    houseCount: state.houseCount,
    sourceTimestamp: latestTimestamp([
      state.sourceTimestamp,
      state.streetSourceTimestamp,
      state.houseSourceTimestamp,
    ]),
    errorCode: streetErrorCode ?? houseErrorCode,
    streetErrorCode,
    houseErrorCode,
    actionRequired: isActionRequiredState(state),
    updatedAt: state.updatedAt,
  };
}

export async function getAreaTaskPreparationState(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
): Promise<AreaPreparationState | null> {
  const row = await db
    .prepare(
      `SELECT campaign_id, area_id, geometry_hash, generation, status, road_count, house_count,
              source_timestamp, started_at, ready_at, failed_at, last_error_code, updated_at,
              street_status, house_status, street_source_timestamp, house_source_timestamp,
              street_started_at, house_started_at, street_ready_at, house_ready_at,
              street_failed_at, house_failed_at, street_error_code, house_error_code
       FROM area_task_preparations
       WHERE campaign_id = ? AND area_id = ?`,
    )
    .bind(campaignId, areaId)
    .first<AreaPreparationRow>();
  return row ? toState(row) : null;
}

export async function getAreaTaskPreparationPublicState(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
): Promise<AreaPreparationPublicState> {
  if (!(await hasAreaTaskPreparationSchema(db))) {
    return publicState(null);
  }
  return publicState(await getAreaTaskPreparationState(db, campaignId, areaId));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function canonicalAreaGeometryJson(geometry: PolygonGeometry) {
  return JSON.stringify(stableValue(geometry));
}

export async function areaGeometryHash(geometry: PolygonGeometry) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalAreaGeometryJson(geometry)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function areaPreparationFingerprint(geometry: PolygonGeometry) {
  const geometryHash = await areaGeometryHash(geometry);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({
      algorithmVersion: AREA_STREET_PREPARATION_ALGORITHM_VERSION,
      geometryHash,
    })),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isFreshPending(state: AreaPreparationState, geometryHash: string, now: Date) {
  const updatedAt = Date.parse(state.updatedAt);
  return (
    state.geometryHash === geometryHash &&
    Number.isFinite(updatedAt) &&
    now.getTime() - updatedAt < AREA_PREPARATION_PENDING_FRESH_MS &&
    (state.streetStatus === "pending" || state.houseStatus === "pending")
  );
}

function validBuildingGeometry(geometry: PolygonGeometry) {
  const ring = geometry.coordinates[0] ?? [];
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  return validatePolygonVertices(ring.slice(0, -1)).valid;
}

type AreaPreparationRoad = {
  properties: { osmId: number; tags: Record<string, string> };
  geometry: DistributionTask["geometry"];
};

type AreaPreparationBuilding = {
  id: string;
  properties: { osmId: number; tags: Record<string, string> };
  geometry: HouseTask["geometry"];
};

export async function prepareStreetTasksForArea(input: {
  campaignId: string;
  area: Area;
  generation: string;
  roads: AreaPreparationRoad[];
  timestamp: string;
  maxRoadFragments?: number;
  streetSourceMetrics?: StreetPreparationSourceMetrics;
  onStreetDiagnostics?: (diagnostics: StreetPreparationDiagnostics) => void;
}): Promise<{ tasks: DistributionTask[]; streetDiagnostics: StreetPreparationDiagnostics }> {
  const maxRoadFragments = input.maxRoadFragments ?? AREA_PREPARATION_MAX_ROAD_FRAGMENTS;
  const preparedStreets = await prepareStreetsForArea({
    campaignId: input.campaignId,
    areaId: input.area.id,
    area: input.area.geometry,
    generation: input.generation,
    roads: input.roads,
    timestamp: input.timestamp,
    maxRoadFragments,
  });
  const tasks = await materializePreparedStreetTasks({
    candidates: preparedStreets.candidates,
    campaignId: input.campaignId,
    areaId: input.area.id,
    generation: input.generation,
    timestamp: input.timestamp,
  });
  const streetDiagnostics: StreetPreparationDiagnostics = {
    ...preparedStreets.diagnostics,
    source: input.streetSourceMetrics ?? preparedStreets.diagnostics.source,
  };
  input.onStreetDiagnostics?.(streetDiagnostics);
  return { tasks, streetDiagnostics };
}

export async function prepareHouseTasksForArea(input: {
  campaignId: string;
  area: Area;
  generation: string;
  buildings: AreaPreparationBuilding[];
  timestamp: string;
  randomUUID: () => string;
  maxBuildings?: number;
}): Promise<HouseTask[]> {
  const maxBuildings = input.maxBuildings ?? AREA_PREPARATION_MAX_BUILDINGS;
  const houseTasks: HouseTask[] = [];
  const buildingIds = new Set<number>();
  for (const building of input.buildings) {
    if (buildingIds.has(building.properties.osmId)) continue;
    buildingIds.add(building.properties.osmId);
    if (!validBuildingGeometry(building.geometry)) continue;
    const representative = polygonRepresentativePoint(building.geometry);
    if (!representative || !pointInOrOnPolygon(representative, input.area.geometry)) continue;
    if (houseTasks.length >= maxBuildings) {
      throw new PreparationFailure(
        "area_preparation_building_volume",
        "Das Gebäudevolumen der Area überschreitet die Sicherheitsgrenze.",
      );
    }
    const house = createSmartHouseTaskSnapshot({
      campaignId: input.campaignId,
      areaId: input.area.id,
      building: toSmartBuildingCandidate({
        type: "Feature",
        id: building.id,
        properties: {
          osmType: "way",
          osmId: building.properties.osmId,
          kind: "building",
          tags: building.properties.tags,
        },
        geometry: building.geometry,
      }),
      parentStreetTaskId: null,
      taskId: "task_" + input.randomUUID(),
      timestamp: input.timestamp,
    });
    houseTasks.push({ ...house, areaPreparationGeneration: input.generation });
  }
  return houseTasks;
}

export async function prepareTasksForArea(input: {
  campaignId: string;
  area: Area;
  generation: string;
  roads: AreaPreparationRoad[];
  buildings: AreaPreparationBuilding[];
  timestamp: string;
  randomUUID: () => string;
  maxRoadFragments?: number;
  maxBuildings?: number;
  streetSourceMetrics?: StreetPreparationSourceMetrics;
  onStreetDiagnostics?: (diagnostics: StreetPreparationDiagnostics) => void;
}): Promise<{
  tasks: DistributionTask[];
  houseTasks: HouseTask[];
  streetDiagnostics: StreetPreparationDiagnostics;
}> {
  const streets = await prepareStreetTasksForArea({
    campaignId: input.campaignId,
    area: input.area,
    generation: input.generation,
    roads: input.roads,
    timestamp: input.timestamp,
    maxRoadFragments: input.maxRoadFragments,
    streetSourceMetrics: input.streetSourceMetrics,
    onStreetDiagnostics: input.onStreetDiagnostics,
  });
  const houseTasks = await prepareHouseTasksForArea({
    campaignId: input.campaignId,
    area: input.area,
    generation: input.generation,
    buildings: input.buildings,
    timestamp: input.timestamp,
    randomUUID: input.randomUUID,
    maxBuildings: input.maxBuildings,
  });
  return {
    tasks: streets.tasks,
    houseTasks,
    streetDiagnostics: streets.streetDiagnostics,
  };
}

/** Splits JSON rows into bounded `json_each(?)` payloads without partial output. */
export function chunkAreaPreparationRows<T>(rows: T[], maxBytes = AREA_PREPARATION_CHUNK_BYTES) {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    if (rowBytes + 2 > maxBytes) {
      throw new PreparationFailure("area_preparation_too_many_features", "Ein Task ist zu groß.");
    }
    const delimiterBytes = current.length ? 1 : 0;
    if (current.length && currentBytes + delimiterBytes + rowBytes + 1 > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += (current.length === 1 ? 0 : 1) + rowBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

type PreparationPhase = "street" | "house";

function phaseStatusColumn(phase: PreparationPhase) {
  return phase === "street" ? "street_status" : "house_status";
}

function phaseErrorColumn(phase: PreparationPhase) {
  return phase === "street" ? "street_error_code" : "house_error_code";
}

function phaseFailedAtColumn(phase: PreparationPhase) {
  return phase === "street" ? "street_failed_at" : "house_failed_at";
}

function aggregateStatusSql(phase: PreparationPhase, nextStatus: AreaPreparationPhaseStatus) {
  const streetStatus = phase === "street" ? `'${nextStatus}'` : "street_status";
  const houseStatus = phase === "house" ? `'${nextStatus}'` : "house_status";
  return `CASE
    WHEN ${streetStatus} = 'failed' THEN 'failed'
    WHEN ${streetStatus} = 'pending' OR ${houseStatus} = 'pending' THEN 'pending'
    WHEN ${streetStatus} = 'ready' THEN 'ready'
    ELSE 'failed'
  END`;
}

function stateGuardSql(phase: PreparationPhase) {
  return `EXISTS (
    SELECT 1 FROM area_task_preparations
    WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ?
      AND ${phaseStatusColumn(phase)} = 'pending'
  )`;
}

function automaticWorkGuardSql() {
  return `NOT EXISTS (
      SELECT 1 FROM tasks
      WHERE campaign_id = ? AND area_id = ?
        AND area_preparation_generation IS NOT NULL AND status <> 'open'
    )
    AND NOT EXISTS (
      SELECT 1 FROM house_tasks
      WHERE campaign_id = ? AND area_id = ?
        AND area_preparation_generation IS NOT NULL AND status <> 'open'
    )`;
}

function publishGuardSql(phase: PreparationPhase) {
  return `EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)
    AND ${stateGuardSql(phase)}
    AND EXISTS (
      SELECT 1 FROM areas WHERE id = ? AND campaign_id = ? AND geometry_json = ?
    )
    AND ${automaticWorkGuardSql()}`;
}

function publishGuardBindings(input: {
  campaignId: string;
  areaId: string;
  writeToken: string;
  generation: string;
  geometryHash: string;
  geometryJson: string;
  phase: PreparationPhase;
}) {
  return [
    input.campaignId,
    input.writeToken,
    input.campaignId,
    input.areaId,
    input.generation,
    input.geometryHash,
    input.areaId,
    input.campaignId,
    input.geometryJson,
    input.campaignId,
    input.areaId,
    input.campaignId,
    input.areaId,
  ];
}

async function markPhaseFailed(
  db: D1DatabaseLike,
  input: {
    phase: PreparationPhase;
    campaignId: string;
    areaId: string;
    generation: string;
    geometryHash: string;
    code: AreaPreparationFailureCode;
    now: string;
  },
) {
  const statusColumn = phaseStatusColumn(input.phase);
  const errorColumn = phaseErrorColumn(input.phase);
  const failedAtColumn = phaseFailedAtColumn(input.phase);
  const lastErrorExpression = input.phase === "street"
    ? "?"
    : "COALESCE(street_error_code, ?)";
  await db.batch([
    db
      .prepare(
        `UPDATE area_task_preparations
         SET ${statusColumn} = 'failed',
             ${failedAtColumn} = ?,
             ${errorColumn} = ?,
             status = ${aggregateStatusSql(input.phase, "failed")},
             failed_at = ?,
             last_error_code = ${lastErrorExpression},
             updated_at = ?
         WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ?
           AND ${statusColumn} = 'pending'`,
      )
      .bind(
        input.now,
        input.code,
        input.now,
        input.code,
        input.now,
        input.campaignId,
        input.areaId,
        input.generation,
        input.geometryHash,
      ),
  ]);
}

function newGenerationPendingStatement(
  db: D1DatabaseLike,
  input: {
    campaignId: string;
    areaId: string;
    geometryHash: string;
    generation: string;
    now: string;
    freshPendingCutoff: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO area_task_preparations (
         campaign_id, area_id, geometry_hash, generation, status,
         road_count, house_count, source_timestamp, started_at, ready_at, failed_at, last_error_code,
         street_status, house_status, street_source_timestamp, house_source_timestamp,
         street_started_at, house_started_at, street_ready_at, house_ready_at,
         street_failed_at, house_failed_at, street_error_code, house_error_code, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', 0, 0, NULL, ?, NULL, NULL, NULL,
                 'pending', 'pending', NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)
       ON CONFLICT(campaign_id, area_id) DO UPDATE SET
         geometry_hash = excluded.geometry_hash,
         generation = excluded.generation,
         status = 'pending',
         road_count = 0,
         house_count = 0,
         source_timestamp = NULL,
         started_at = excluded.started_at,
         ready_at = NULL,
         failed_at = NULL,
         last_error_code = NULL,
         street_status = 'pending',
         house_status = 'pending',
         street_source_timestamp = NULL,
         house_source_timestamp = NULL,
         street_started_at = excluded.street_started_at,
         house_started_at = excluded.house_started_at,
         street_ready_at = NULL,
         house_ready_at = NULL,
         street_failed_at = NULL,
         house_failed_at = NULL,
         street_error_code = NULL,
         house_error_code = NULL,
         updated_at = excluded.updated_at
       WHERE NOT (
         area_task_preparations.status = 'pending'
         AND area_task_preparations.geometry_hash = excluded.geometry_hash
         AND area_task_preparations.updated_at > ?
       )`,
    )
    .bind(
      input.campaignId,
      input.areaId,
      input.geometryHash,
      input.generation,
      input.now,
      input.now,
      input.now,
      input.now,
      input.freshPendingCutoff,
    );
}

function retryPendingStatement(
  db: D1DatabaseLike,
  input: {
    campaignId: string;
    areaId: string;
    geometryHash: string;
    generation: string;
    now: string;
    phases: PreparationPhase[];
  },
) {
  const assignments = [
    "status = 'pending'",
    "started_at = ?",
    "failed_at = NULL",
    "last_error_code = NULL",
  ];
  const bindings: unknown[] = [input.now];
  const pendingConditions: string[] = [];
  if (input.phases.includes("street")) {
    assignments.push(
      "street_status = 'pending'",
      "street_started_at = ?",
      "street_ready_at = NULL",
      "street_failed_at = NULL",
      "street_error_code = NULL",
      "street_source_timestamp = NULL",
      "road_count = 0",
    );
    bindings.push(input.now);
    pendingConditions.push("street_status <> 'pending'");
  }
  if (input.phases.includes("house")) {
    assignments.push(
      "house_status = 'pending'",
      "house_started_at = ?",
      "house_ready_at = NULL",
      "house_failed_at = NULL",
      "house_error_code = NULL",
      "house_source_timestamp = NULL",
      "house_count = 0",
    );
    bindings.push(input.now);
    pendingConditions.push("house_status <> 'pending'");
  }
  assignments.push("updated_at = ?");
  bindings.push(input.now);
  return db
    .prepare(
      `UPDATE area_task_preparations
       SET ${assignments.join(", ")}
       WHERE campaign_id = ? AND area_id = ? AND geometry_hash = ? AND generation = ?
         AND ${pendingConditions.join(" AND ")}`,
    )
    .bind(
      ...bindings,
      input.campaignId,
      input.areaId,
      input.geometryHash,
      input.generation,
    );
}

function campaignPublishStatement(
  db: D1DatabaseLike,
  input: {
    phase: PreparationPhase;
    campaignId: string;
    areaId: string;
    revision: number;
    writeToken: string;
    generation: string;
    geometryHash: string;
    geometryJson: string;
    now: string;
  },
) {
  return db
    .prepare(
      `UPDATE campaigns
       SET revision = ?, write_token = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         AND ${stateGuardSql(input.phase)}
         AND ${automaticWorkGuardSql()}
         AND EXISTS (
           SELECT 1 FROM areas WHERE id = ? AND campaign_id = ? AND geometry_json = ?
         )`,
    )
    .bind(
      input.revision + 1,
      input.writeToken,
      input.now,
      input.campaignId,
      input.revision,
      input.campaignId,
      input.areaId,
      input.generation,
      input.geometryHash,
      input.campaignId,
      input.areaId,
      input.campaignId,
      input.areaId,
      input.areaId,
      input.campaignId,
      input.geometryJson,
    );
}

function tasksInsertStatement(
  db: D1DatabaseLike,
  rows: DistributionTask[],
  guard: ReturnType<typeof publishGuardBindings>,
) {
  return db
    .prepare(
      `INSERT INTO tasks (
         id, campaign_id, area_id, task_type, label, geometry_json, source_json,
         area_preparation_generation, status, completed_at, created_at, updated_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.areaId'),
         'street',
         json_extract(value, '$.label'),
         json_extract(value, '$.geometry'),
         json_extract(value, '$.source'),
         json_extract(value, '$.areaPreparationGeneration'),
         'open', NULL,
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${publishGuardSql("street")}`,
    )
    .bind(JSON.stringify(rows), ...guard);
}

function streetTasksUpdateStatement(
  db: D1DatabaseLike,
  input: { campaignId: string; areaId: string; rows: DistributionTask[] },
  guard: ReturnType<typeof publishGuardBindings>,
) {
  if (input.rows.length === 0) {
    return db.prepare("SELECT 1 WHERE " + publishGuardSql("street")).bind(...guard);
  }
  const serialized = JSON.stringify(input.rows);
  return db
    .prepare(
      `UPDATE tasks
       SET geometry_json = (
             SELECT json_extract(prepared.value, '$.geometry')
             FROM json_each(?) AS prepared
             WHERE json_extract(prepared.value, '$.id') = tasks.id
           ),
           source_json = (
             SELECT json_extract(prepared.value, '$.source')
             FROM json_each(?) AS prepared
             WHERE json_extract(prepared.value, '$.id') = tasks.id
           ),
           area_preparation_generation = (
             SELECT json_extract(prepared.value, '$.areaPreparationGeneration')
             FROM json_each(?) AS prepared
             WHERE json_extract(prepared.value, '$.id') = tasks.id
           ),
           updated_at = (
             SELECT json_extract(prepared.value, '$.updatedAt')
             FROM json_each(?) AS prepared
             WHERE json_extract(prepared.value, '$.id') = tasks.id
           )
       WHERE campaign_id = ? AND area_id = ? AND task_type = 'street'
         AND area_preparation_generation IS NOT NULL
         AND id IN (
           SELECT json_extract(value, '$.id') FROM json_each(?)
         )
         AND ${publishGuardSql("street")}`,
    )
    .bind(
      serialized,
      serialized,
      serialized,
      serialized,
      input.campaignId,
      input.areaId,
      serialized,
      ...guard,
    );
}

function streetTasksDeleteStatement(
  db: D1DatabaseLike,
  input: { campaignId: string; areaId: string; deleteIds: string[] },
  guard: ReturnType<typeof publishGuardBindings>,
) {
  if (input.deleteIds.length === 0) {
    return db.prepare("SELECT 1 WHERE " + publishGuardSql("street")).bind(...guard);
  }
  return db
    .prepare(
      "DELETE FROM tasks\n"
        + "WHERE campaign_id = ? AND area_id = ?\n"
        + "  AND id IN (SELECT value FROM json_each(?))\n"
        + "  AND area_preparation_generation IS NOT NULL AND status = 'open'\n"
        + "  AND " + publishGuardSql("street"),
    )
    .bind(input.campaignId, input.areaId, JSON.stringify(input.deleteIds), ...guard);
}

function houseTasksDeleteStatement(
  db: D1DatabaseLike,
  input: { campaignId: string; areaId: string },
  guard: ReturnType<typeof publishGuardBindings>,
) {
  return db
    .prepare(
      "DELETE FROM house_tasks\n"
        + "WHERE campaign_id = ? AND area_id = ?\n"
        + "  AND area_preparation_generation IS NOT NULL AND status = 'open'\n"
        + "  AND " + publishGuardSql("house"),
    )
    .bind(input.campaignId, input.areaId, ...guard);
}

function houseTasksInsertStatement(
  db: D1DatabaseLike,
  rows: HouseTask[],
  guard: ReturnType<typeof publishGuardBindings>,
) {
  return db
    .prepare(
      `INSERT INTO house_tasks (
         id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
         area_preparation_generation, status, completed_at, created_at, updated_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.areaId'),
         NULL,
         json_extract(value, '$.label'),
         json_extract(value, '$.geometry'),
         json_extract(value, '$.source'),
         json_extract(value, '$.areaPreparationGeneration'),
         'open', NULL,
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${publishGuardSql("house")}`,
    )
    .bind(JSON.stringify(rows), ...guard);
}

function phaseReadyStatement(
  db: D1DatabaseLike,
  input: {
    phase: PreparationPhase;
    campaignId: string;
    areaId: string;
    generation: string;
    geometryHash: string;
    count: number;
    sourceTimestamp: string | null;
    now: string;
  },
  guard: ReturnType<typeof publishGuardBindings>,
) {
  if (input.phase === "street") {
    return db
      .prepare(
        `UPDATE area_task_preparations
         SET street_status = 'ready',
             road_count = ?,
             street_source_timestamp = ?,
             street_ready_at = ?,
             street_failed_at = NULL,
             street_error_code = NULL,
             status = ${aggregateStatusSql("street", "ready")},
             source_timestamp = COALESCE(?, house_source_timestamp),
             ready_at = CASE WHEN house_status = 'ready' THEN ? ELSE NULL END,
             failed_at = NULL,
             last_error_code = house_error_code,
             updated_at = ?
         WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ?
           AND street_status = 'pending' AND ${publishGuardSql("street")}`,
      )
      .bind(
        input.count,
        input.sourceTimestamp,
        input.now,
        input.sourceTimestamp,
        input.now,
        input.now,
        input.campaignId,
        input.areaId,
        input.generation,
        input.geometryHash,
        ...guard,
      );
  }
  return db
    .prepare(
      `UPDATE area_task_preparations
       SET house_status = 'ready',
           house_count = ?,
           house_source_timestamp = ?,
           house_ready_at = ?,
           house_failed_at = NULL,
           house_error_code = NULL,
           status = ${aggregateStatusSql("house", "ready")},
           source_timestamp = COALESCE(?, street_source_timestamp),
           ready_at = CASE WHEN street_status = 'ready' THEN ? ELSE NULL END,
           last_error_code = street_error_code,
           updated_at = ?
       WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ?
         AND house_status = 'pending' AND ${publishGuardSql("house")}`,
    )
    .bind(
      input.count,
      input.sourceTimestamp,
      input.now,
      input.sourceTimestamp,
      input.now,
      input.now,
      input.campaignId,
      input.areaId,
      input.generation,
      input.geometryHash,
      ...guard,
    );
}

function failureCode(error: unknown): AreaPreparationFailureCode {
  if (error instanceof StreetPreparationLimitError) {
    return "area_preparation_too_many_features";
  }
  if (error instanceof PreparationFailure) return error.code;
  if (error instanceof OsmFeaturesForAreaError) {
    if (error.reason === "rate-limited") return "area_preparation_osm_rate_limited";
    if (error.reason === "server-error") return "area_preparation_osm_server_error";
    if (
      error.phase === "buildings"
      && (error.reason === "response-too-large" || error.reason === "aggregate-too-large")
    ) {
      return "area_preparation_building_volume";
    }
    if (error.reason === "response-too-large") {
      return "area_preparation_osm_response_too_large";
    }
    switch (error.code) {
      case "too_large": return "area_preparation_too_large";
      case "timeout": return "area_preparation_osm_timeout";
      case "invalid": return "area_preparation_osm_invalid";
      default: return "area_preparation_osm_failed";
    }
  }
  return "area_preparation_osm_failed";
}

function phaseFailureResult(
  state: AreaPreparationState | null,
  phase: PreparationPhase,
): PrepareAreaTasksResult {
  const code = phase === "street"
    ? state?.streetErrorCode
    : state?.houseErrorCode;
  return { outcome: "failed", code: code ?? "area_preparation_osm_failed" };
}

async function markPhaseError(
  db: D1DatabaseLike,
  input: {
    phase: PreparationPhase;
    campaignId: string;
    areaId: string;
    generation: string;
    geometryHash: string;
    now: string;
  },
  error: unknown,
) {
  const code = failureCode(error);
  await markPhaseFailed(db, { ...input, code });
  return { status: "failed" as const, code };
}

type PhasePublishResult =
  | { status: "ready"; count: number }
  | { status: "failed"; code: AreaPreparationFailureCode }
  | { status: "stale" };

async function publishStreetPhase(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: AreaTaskPreparationOptions,
  tasks: DistributionTask[],
  sourceTimestamp: string | null,
): Promise<PhasePublishResult> {
  const snapshot = await loadCampaignSnapshot(db, run.campaignId);
  if (!snapshot) return { status: "stale" };
  const reconciliation = reconcilePreparedStreetTasks({
    existingTasks: snapshot.tasks,
    preparedTasks: tasks,
    campaignId: run.campaignId,
    areaId: run.areaId,
  });
  if (reconciliation.outcome === "blocked-worked") {
    await markPhaseFailed(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code: "area_preparation_work_started",
      now: run.now,
    });
    return { status: "failed", code: "area_preparation_work_started" };
  }
  const taskChunks = chunkAreaPreparationRows(reconciliation.inserts, options.chunkBytes);
  const updateChunks = chunkAreaPreparationRows(reconciliation.updates, options.chunkBytes);
  if (taskChunks.length + updateChunks.length > AREA_PREPARATION_MAX_INSERT_CHUNKS) {
    await markPhaseFailed(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code: "area_preparation_too_many_features",
      now: run.now,
    });
    return { status: "failed", code: "area_preparation_too_many_features" };
  }
  const writeToken = (options.randomUUID ?? (() => crypto.randomUUID()))();
  const geometryJson = JSON.stringify(run.area.geometry);
  const guard = publishGuardBindings({
    campaignId: run.campaignId,
    areaId: run.areaId,
    writeToken,
    generation: run.generation,
    geometryHash: run.geometryHash,
    geometryJson,
    phase: "street",
  });
  const statements: D1PreparedStatement[] = [
    campaignPublishStatement(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      revision: snapshot.revision,
      writeToken,
      generation: run.generation,
      geometryHash: run.geometryHash,
      geometryJson,
      now: run.now,
    }),
    streetTasksDeleteStatement(
      db,
      { campaignId: run.campaignId, areaId: run.areaId, deleteIds: reconciliation.deleteIds },
      guard,
    ),
    ...updateChunks.map((rows) =>
      streetTasksUpdateStatement(db, {
        campaignId: run.campaignId,
        areaId: run.areaId,
        rows,
      }, guard)
    ),
    ...taskChunks.map((chunk) => tasksInsertStatement(db, chunk, guard)),
    phaseReadyStatement(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      count: tasks.length,
      sourceTimestamp,
      now: run.now,
    }, guard),
  ];
  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await db.batch(statements);
  } catch {
    await markPhaseFailed(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code: "area_preparation_publish_failed",
      now: run.now,
    });
    return { status: "failed", code: "area_preparation_publish_failed" };
  }
  if (
    (results[0]?.meta?.changes ?? 0) !== 1 ||
    (results[results.length - 1]?.meta?.changes ?? 0) !== 1
  ) {
    const code = await areaHasStartedAutomaticWork(db, run.campaignId, run.areaId)
      ? "area_preparation_work_started"
      : "area_preparation_stale";
    await markPhaseFailed(db, {
      phase: "street",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code,
      now: run.now,
    });
    return code === "area_preparation_stale"
      ? { status: "stale" }
      : { status: "failed", code };
  }
  return { status: "ready", count: tasks.length };
}

async function publishHousePhase(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: AreaTaskPreparationOptions,
  houseTasks: HouseTask[],
  sourceTimestamp: string | null,
): Promise<PhasePublishResult> {
  const snapshot = await loadCampaignSnapshot(db, run.campaignId);
  if (!snapshot) return { status: "stale" };
  const writeToken = (options.randomUUID ?? (() => crypto.randomUUID()))();
  const geometryJson = JSON.stringify(run.area.geometry);
  const guard = publishGuardBindings({
    campaignId: run.campaignId,
    areaId: run.areaId,
    writeToken,
    generation: run.generation,
    geometryHash: run.geometryHash,
    geometryJson,
    phase: "house",
  });
  const statements: D1PreparedStatement[] = [
    campaignPublishStatement(db, {
      phase: "house",
      campaignId: run.campaignId,
      areaId: run.areaId,
      revision: snapshot.revision,
      writeToken,
      generation: run.generation,
      geometryHash: run.geometryHash,
      geometryJson,
      now: run.now,
    }),
    houseTasksDeleteStatement(db, {
      campaignId: run.campaignId,
      areaId: run.areaId,
    }, guard),
    houseTasksInsertStatement(db, houseTasks, guard),
    phaseReadyStatement(db, {
      phase: "house",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      count: houseTasks.length,
      sourceTimestamp,
      now: run.now,
    }, guard),
  ];
  let results: Awaited<ReturnType<D1DatabaseLike["batch"]>>;
  try {
    results = await db.batch(statements);
  } catch {
    await markPhaseFailed(db, {
      phase: "house",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code: "area_preparation_publish_failed",
      now: run.now,
    });
    return { status: "failed", code: "area_preparation_publish_failed" };
  }
  if (
    (results[0]?.meta?.changes ?? 0) !== 1 ||
    (results[results.length - 1]?.meta?.changes ?? 0) !== 1
  ) {
    const code = await areaHasStartedAutomaticWork(db, run.campaignId, run.areaId)
      ? "area_preparation_work_started"
      : "area_preparation_stale";
    await markPhaseFailed(db, {
      phase: "house",
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      geometryHash: run.geometryHash,
      code,
      now: run.now,
    });
    return code === "area_preparation_stale"
      ? { status: "stale" }
      : { status: "failed", code };
  }
  return { status: "ready", count: houseTasks.length };
}

function phaseLimits(
  options: AreaTaskPreparationOptions,
  consumedUpstreamBytes: number,
  consumedPackageBytes: number,
) {
  const maxAggregateBytes = options.limits?.maxAggregateBytes ?? AREA_PREPARATION_MAX_AGGREGATE_BYTES;
  const maxPackageBytes = options.limits?.maxPackageBytes ?? AREA_PREPARATION_MAX_AGGREGATE_BYTES;
  return {
    ...options.limits,
    maxAggregateBytes: Math.max(0, maxAggregateBytes - consumedUpstreamBytes),
    maxPackageBytes: Math.max(0, maxPackageBytes - consumedPackageBytes),
  };
}

/**
 * Claims one durable pending generation before any phase upstream request starts.
 * A partial retry keeps the already-ready phase and reuses the same generation.
 */
export async function beginAreaTaskPreparation(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
  options: AreaTaskPreparationOptions = {},
): Promise<BeginAreaTaskPreparationResult> {
  if (!(await hasAreaTaskPreparationSchema(db))) {
    return {
      outcome: "result",
      result: { outcome: "failed", code: "area_preparation_schema_unavailable" },
    };
  }
  const snapshot = await loadCampaignSnapshot(db, campaignId);
  const area = snapshot?.areas.find((candidate) => candidate.id === areaId);
  if (!snapshot || !area) return { outcome: "result", result: { outcome: "missing" } };

  const nowDate = (options.now ?? (() => new Date()))();
  const now = nowDate.toISOString();
  const geometryHash = await areaPreparationFingerprint(area.geometry);
  const current = await getAreaTaskPreparationState(db, campaignId, areaId);
  const sameGeometry = current?.geometryHash === geometryHash;
  const phases: PreparationPhase[] = sameGeometry && current
    ? [
        ...(current.streetStatus === "ready" ? [] : ["street" as const]),
        ...(current.houseStatus === "ready" ? [] : ["house" as const]),
      ]
    : ["street", "house"];
  if (
    (current && isActionRequiredState(current)) ||
    (await areaHasStartedAutomaticWork(db, campaignId, areaId))
  ) {
    return {
      outcome: "result",
      result: { outcome: "failed", code: "area_preparation_work_started" },
    };
  }
  if (phases.length === 0) {
    return { outcome: "result", result: { outcome: "no-op", state: "ready" } };
  }
  if (current && isFreshPending(current, geometryHash, nowDate)) {
    return { outcome: "result", result: { outcome: "no-op", state: "pending" } };
  }

  const generation = sameGeometry && current
    ? current.generation
    : (options.randomUUID ?? (() => crypto.randomUUID()))();
  try {
    const started = await db.batch([
      sameGeometry && current
        ? retryPendingStatement(db, {
            campaignId,
            areaId,
            geometryHash,
            generation,
            now,
            phases,
          })
        : newGenerationPendingStatement(db, {
            campaignId,
            areaId,
            geometryHash,
            generation,
            now,
            freshPendingCutoff: new Date(
              nowDate.getTime() - AREA_PREPARATION_PENDING_FRESH_MS,
            ).toISOString(),
          }),
    ]);
    if ((started[0]?.meta?.changes ?? 0) === 0) {
      return { outcome: "result", result: { outcome: "no-op", state: "pending" } };
    }
  } catch {
    return {
      outcome: "result",
      result: { outcome: "stale", code: "area_preparation_stale" },
    };
  }

  return {
    outcome: "run",
    run: { campaignId, areaId, snapshot, area, geometryHash, generation, phases, now },
  };
}

/**
 * Runs independent Road/Street and Building/House branches. Each branch has an
 * atomic guarded publish, so a House upstream failure never hides ready Streets.
 */
export async function runAreaTaskPreparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: AreaTaskPreparationOptions = {},
): Promise<PrepareAreaTasksResult> {
  const { campaignId, areaId, area, geometryHash, generation, now } = run;
  let roadFeatures: Awaited<ReturnType<typeof fetchOsmFeaturesForArea>> | null = null;
  let stale = false;

  if (run.phases.includes("street")) {
    try {
      roadFeatures = await fetchOsmFeaturesForArea({
        geometry: area.geometry,
        upstreamUrl: options.upstreamUrl,
        fetchImpl: options.fetchImpl,
        now: options.now,
        limits: options.limits,
        phase: "roads",
      });
      const preparedStreets = await prepareStreetTasksForArea({
        campaignId,
        area,
        generation,
        roads: roadFeatures.roads,
        timestamp: now,
        maxRoadFragments: options.maxRoadFragments,
        streetSourceMetrics: roadFeatures.metrics,
        onStreetDiagnostics: options.onStreetDiagnostics,
      });
      const published = await publishStreetPhase(
        db,
        run,
        options,
        preparedStreets.tasks,
        roadFeatures.sourceTimestamp,
      );
      if (published.status === "stale") stale = true;
    } catch (error) {
      await markPhaseError(db, {
        phase: "street",
        campaignId,
        areaId,
        generation,
        geometryHash,
        now,
      }, error);
    }
  }

  if (run.phases.includes("house") && !stale) {
    try {
      const buildingFeatures = await fetchOsmFeaturesForArea({
        geometry: area.geometry,
        upstreamUrl: options.upstreamUrl,
        fetchImpl: options.fetchImpl,
        now: options.now,
        limits: phaseLimits(
          options,
          roadFeatures?.metrics.upstreamBytes ?? 0,
          roadFeatures?.metrics.packageBytes ?? 0,
        ),
        phase: "buildings",
      });
      const houseTasks = await prepareHouseTasksForArea({
        campaignId,
        area,
        generation,
        buildings: buildingFeatures.buildings,
        timestamp: now,
        randomUUID: options.randomUUID ?? (() => crypto.randomUUID()),
        maxBuildings: options.maxBuildings,
      });
      const published = await publishHousePhase(
        db,
        run,
        options,
        houseTasks,
        buildingFeatures.sourceTimestamp,
      );
      if (published.status === "stale") stale = true;
    } catch (error) {
      await markPhaseError(db, {
        phase: "house",
        campaignId,
        areaId,
        generation,
        geometryHash,
        now,
      }, error);
    }
  }

  if (stale) return { outcome: "stale", code: "area_preparation_stale" };
  const state = await getAreaTaskPreparationState(db, campaignId, areaId);
  if (state?.streetStatus === "ready") {
    return {
      outcome: "ready",
      roadCount: state.roadCount,
      houseCount: state.houseCount,
      generation: state.generation,
    };
  }
  return phaseFailureResult(state, "street");
}

/** Starts and, when claimed, completes server-owned Area preparation phases. */
export async function prepareAreaTasks(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
  options: AreaTaskPreparationOptions = {},
): Promise<PrepareAreaTasksResult> {
  const started = await beginAreaTaskPreparation(db, campaignId, areaId, options);
  return started.outcome === "run"
    ? runAreaTaskPreparation(db, started.run, options)
    : started.result;
}

export async function areaHasStartedAutomaticWork(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
) {
  if (!(await hasAreaTaskPreparationSchema(db))) return false;
  const [task, house] = await Promise.all([
    db
      .prepare(
        `SELECT id FROM tasks
         WHERE campaign_id = ? AND area_id = ?
           AND area_preparation_generation IS NOT NULL AND status <> 'open' LIMIT 1`,
      )
      .bind(campaignId, areaId)
      .first<{ id: string }>(),
    db
      .prepare(
        `SELECT id FROM house_tasks
         WHERE campaign_id = ? AND area_id = ?
           AND area_preparation_generation IS NOT NULL AND status <> 'open' LIMIT 1`,
      )
      .bind(campaignId, areaId)
      .first<{ id: string }>(),
  ]);
  return Boolean(task || house);
}

/** Helps the recovery endpoint decide whether it should queue a new job. */
export async function shouldStartAreaPreparation(
  db: D1DatabaseLike,
  campaignId: string,
  area: Area,
  now = new Date(),
) {
  if (!(await hasAreaTaskPreparationSchema(db))) {
    return { schemaAvailable: false as const, shouldStart: false, state: publicState(null) };
  }
  const geometryHash = await areaPreparationFingerprint(area.geometry);
  const state = await getAreaTaskPreparationState(db, campaignId, area.id);
  const sameGeometry = state?.geometryHash === geometryHash;
  const complete = Boolean(
    sameGeometry &&
    state &&
    state.streetStatus === "ready" &&
    state.houseStatus === "ready",
  );
  if (complete) {
    return { schemaAvailable: true as const, shouldStart: false, state: publicState(state) };
  }
  if (state && isFreshPending(state, geometryHash, now)) {
    return { schemaAvailable: true as const, shouldStart: false, state: publicState(state) };
  }
  if (
    (state && isActionRequiredState(state)) ||
    (await areaHasStartedAutomaticWork(db, campaignId, area.id))
  ) {
    return {
      schemaAvailable: true as const,
      shouldStart: false,
      state: {
        ...publicState(state),
        errorCode: "area_preparation_work_started",
        actionRequired: true,
      },
    };
  }
  return { schemaAvailable: true as const, shouldStart: true, state: publicState(state) };
}
