import type {
  Area,
  CampaignSnapshot,
  DistributionTask,
  HouseTask,
  PolygonGeometry,
} from "../src/domain/campaign.ts";
import {
  clipLineStringToPolygon,
  pointInOrOnPolygon,
  polygonRepresentativePoint,
} from "../src/domain/areaTaskPreparation.ts";
import { validateLineStringVertices, validatePolygonVertices } from "../src/domain/geometry.ts";
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
  hasRxdbSyncSchema,
  rxdbChangeFeedEntriesForSnapshotDelta,
  rxdbChangeFeedStatements,
} from "./rxdbChangeFeed.ts";
import {
  AREA_STREET_PREPARATION_ALGORITHM_VERSION,
  areaStreetPreparationFingerprint,
  reconcileServerPreparedStreetTasks,
  type PreparedStreetCandidate,
} from "./serverPreparedStreetReconcile.ts";

export { AREA_STREET_PREPARATION_ALGORITHM_VERSION };

export const AREA_PREPARATION_PENDING_FRESH_MS = 60_000;
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
  | "area_preparation_too_many_features"
  | "area_preparation_work_started"
  | "area_preparation_stale";

export type AreaPreparationStateStatus = "pending" | "ready" | "failed";

export type AreaPreparationState = {
  campaignId: string;
  areaId: string;
  geometryHash: string;
  generation: string;
  status: AreaPreparationStateStatus;
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  startedAt: string | null;
  readyAt: string | null;
  failedAt: string | null;
  lastErrorCode: AreaPreparationFailureCode | null;
  updatedAt: string;
};

export type AreaPreparationPublicState = {
  status: "missing" | AreaPreparationStateStatus;
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  errorCode: AreaPreparationFailureCode | null;
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
  /** Runs after the guarded D1/feed publish; failures must not roll back the publish. */
  onCommitted?: () => void | Promise<void>;
};

/** A claimed, server-owned run whose pending state is already durable in D1. */
export type AreaTaskPreparationRun = {
  campaignId: string;
  areaId: string;
  snapshot: CampaignSnapshot;
  area: Area;
  /** Versioned area-preparation fingerprint stored in the legacy geometry_hash column. */
  geometryHash: string;
  generation: string;
  now: string;
};

export type BeginAreaTaskPreparationResult =
  | { outcome: "run"; run: AreaTaskPreparationRun }
  | { outcome: "result"; result: PrepareAreaTasksResult };

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
};

class PreparationFailure extends Error {
  readonly code: AreaPreparationFailureCode;

  constructor(code: AreaPreparationFailureCode, message: string) {
    super(message);
    this.name = "PreparationFailure";
    this.code = code;
  }
}

function toState(row: AreaPreparationRow): AreaPreparationState {
  return {
    campaignId: row.campaign_id,
    areaId: row.area_id,
    geometryHash: row.geometry_hash,
    generation: row.generation,
    status: row.status,
    roadCount: row.road_count,
    houseCount: row.house_count,
    sourceTimestamp: row.source_timestamp,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    failedAt: row.failed_at,
    lastErrorCode: row.last_error_code,
    updatedAt: row.updated_at,
  };
}

function publicState(state: AreaPreparationState | null): AreaPreparationPublicState {
  return state
    ? {
        status: state.status,
        roadCount: state.roadCount,
        houseCount: state.houseCount,
        sourceTimestamp: state.sourceTimestamp,
        errorCode: state.lastErrorCode,
        updatedAt: state.updatedAt,
      }
    : {
        status: "missing",
        roadCount: 0,
        houseCount: 0,
        sourceTimestamp: null,
        errorCode: null,
        updatedAt: null,
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
              source_timestamp, started_at, ready_at, failed_at, last_error_code, updated_at
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

export function areaPreparationFingerprint(
  geometry: PolygonGeometry,
  algorithmVersion = AREA_STREET_PREPARATION_ALGORITHM_VERSION,
) {
  return areaStreetPreparationFingerprint(canonicalAreaGeometryJson(geometry), algorithmVersion);
}

function isFreshPending(state: AreaPreparationState, geometryHash: string, now: Date) {
  const updatedAt = Date.parse(state.updatedAt);
  return (
    state.status === "pending" &&
    state.geometryHash === geometryHash &&
    Number.isFinite(updatedAt) &&
    now.getTime() - updatedAt < AREA_PREPARATION_PENDING_FRESH_MS
  );
}

function roadLabel(tags: Record<string, string>) {
  return tags.name?.trim() || tags.ref?.trim() || "Straße";
}

function validBuildingGeometry(geometry: PolygonGeometry) {
  const ring = geometry.coordinates[0] ?? [];
  if (ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  return validatePolygonVertices(ring.slice(0, -1)).valid;
}

/**
 * Existing clipping is intentionally kept outside the persistence contract.
 * A future geometry engine only has to produce these plain prepared fragments.
 */
export function prepareTasksForArea(input: {
  campaignId: string;
  area: Area;
  generation: string;
  roads: Array<{
    properties: { osmId: number; tags: Record<string, string> };
    geometry: DistributionTask["geometry"];
  }>;
  buildings: Array<{
    id: string;
    properties: { osmId: number; tags: Record<string, string> };
    geometry: HouseTask["geometry"];
  }>;
  timestamp: string;
  randomUUID: () => string;
  maxRoadFragments?: number;
  maxBuildings?: number;
}): { preparedFragments: PreparedStreetCandidate[]; houseTasks: HouseTask[] } {
  const maxRoadFragments = input.maxRoadFragments ?? AREA_PREPARATION_MAX_ROAD_FRAGMENTS;
  const maxBuildings = input.maxBuildings ?? AREA_PREPARATION_MAX_BUILDINGS;
  const preparedFragments: PreparedStreetCandidate[] = [];
  const roadIds = new Set<number>();
  for (const road of input.roads) {
    if (roadIds.has(road.properties.osmId)) continue;
    roadIds.add(road.properties.osmId);
    const fragments = clipLineStringToPolygon(road.geometry, input.area.geometry);
    for (const geometry of fragments) {
      if (!validateLineStringVertices(geometry.coordinates).valid) continue;
      if (preparedFragments.length >= maxRoadFragments) {
        throw new PreparationFailure(
          "area_preparation_too_many_features",
          "Zu viele Straßenfragmente in der Area.",
        );
      }
      preparedFragments.push({
        sourceOsmWayId: road.properties.osmId,
        label: roadLabel(road.properties.tags),
        geometry,
      });
    }
  }

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
        "area_preparation_too_many_features",
        "Zu viele Gebäude in der Area.",
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
      taskId: `task_${input.randomUUID()}`,
      timestamp: input.timestamp,
    });
    houseTasks.push({ ...house, areaPreparationGeneration: input.generation });
  }
  return { preparedFragments, houseTasks };
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

function stateGuardSql() {
  return `EXISTS (
    SELECT 1 FROM area_task_preparations
    WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ? AND status = 'pending'
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

function publishGuardSql() {
  return `EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)
    AND ${stateGuardSql()}
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

async function markPreparationFailed(
  db: D1DatabaseLike,
  input: {
    campaignId: string;
    areaId: string;
    generation: string;
    geometryHash: string;
    code: AreaPreparationFailureCode;
    now: string;
  },
) {
  await db.batch([
    db
      .prepare(
        `UPDATE area_task_preparations
         SET status = 'failed', failed_at = ?, last_error_code = ?, updated_at = ?
         WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ? AND status = 'pending'`,
      )
      .bind(
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

function upsertPendingStatement(
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
         campaign_id, area_id, geometry_hash, generation, status, road_count, house_count,
         source_timestamp, started_at, ready_at, failed_at, last_error_code, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', 0, 0, NULL, ?, NULL, NULL, NULL, ?)
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
      input.freshPendingCutoff,
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
       WHERE ${publishGuardSql()}`,
    )
    .bind(JSON.stringify(rows), ...guard);
}

function tasksDeleteStatement(
  db: D1DatabaseLike,
  ids: string[],
  campaignId: string,
  areaId: string,
  guard: ReturnType<typeof publishGuardBindings>,
) {
  return db
    .prepare(
      `DELETE FROM tasks
       WHERE campaign_id = ? AND area_id = ?
         AND id IN (SELECT value FROM json_each(?))
         AND area_preparation_generation IS NOT NULL AND status = 'open'
         AND ${publishGuardSql()}`,
    )
    .bind(campaignId, areaId, JSON.stringify(ids), ...guard);
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
       WHERE ${publishGuardSql()}`,
    )
    .bind(JSON.stringify(rows), ...guard);
}

function failureCode(error: unknown): AreaPreparationFailureCode {
  if (error instanceof PreparationFailure) return error.code;
  if (error instanceof OsmFeaturesForAreaError) {
    switch (error.code) {
      case "too_large": return "area_preparation_too_large";
      case "timeout": return "area_preparation_osm_timeout";
      case "invalid": return "area_preparation_osm_invalid";
      default: return "area_preparation_osm_failed";
    }
  }
  return "area_preparation_osm_failed";
}

/**
 * Claims one durable pending generation before any upstream request starts.
 * This lets recovery POST return an honest pending state and prevents a second
 * request from scheduling another OSM fetch for the same fresh fingerprint.
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
  if (current?.status === "ready" && current.geometryHash === geometryHash) {
    return { outcome: "result", result: { outcome: "no-op", state: "ready" } };
  }
  if (current && isFreshPending(current, geometryHash, nowDate)) {
    return { outcome: "result", result: { outcome: "no-op", state: "pending" } };
  }
  if (await areaHasStartedAutomaticWork(db, campaignId, areaId)) {
    return {
      outcome: "result",
      result: { outcome: "failed", code: "area_preparation_work_started" },
    };
  }

  const generation = (options.randomUUID ?? (() => crypto.randomUUID()))();
  try {
    const freshPendingCutoff = new Date(
      nowDate.getTime() - AREA_PREPARATION_PENDING_FRESH_MS,
    ).toISOString();
    const started = await db.batch([
      upsertPendingStatement(db, {
        campaignId,
        areaId,
        geometryHash,
        generation,
        now,
        freshPendingCutoff,
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
    run: { campaignId, areaId, snapshot, area, geometryHash, generation, now },
  };
}

/**
 * Runs the upstream fetch and the guarded atomic publish for a previously
 * claimed generation. The only publish boundary is the final D1 batch, so
 * failed or stale jobs cannot expose partial automatic Tasks or feed entries.
 */
export async function runAreaTaskPreparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: AreaTaskPreparationOptions = {},
): Promise<PrepareAreaTasksResult> {
  const { campaignId, areaId, snapshot, area, geometryHash, generation, now } = run;

  try {
    const osm = await fetchOsmFeaturesForArea({
      geometry: area.geometry,
      upstreamUrl: options.upstreamUrl,
      fetchImpl: options.fetchImpl,
      now: options.now,
      limits: options.limits,
    });
    const prepared = prepareTasksForArea({
      campaignId,
      area,
      generation,
      roads: osm.roads,
      buildings: osm.buildings,
      timestamp: now,
      randomUUID: options.randomUUID ?? (() => crypto.randomUUID()),
      maxRoadFragments: options.maxRoadFragments,
      maxBuildings: options.maxBuildings,
    });
    const streetReconcile = await reconcileServerPreparedStreetTasks({
      existingTasks: snapshot.tasks,
      preparedFragments: prepared.preparedFragments,
      campaignId,
      areaId,
      generation,
      timestamp: now,
    });
    if (streetReconcile.outcome === "blocked-worked") {
      throw new PreparationFailure(
        "area_preparation_work_started",
        "Bereits bearbeitete automatische Straßen verhindern ein sicheres Reprepare.",
      );
    }
    const roadCount = streetReconcile.afterTasks.filter(
      (task) => task.areaId === areaId && task.areaPreparationGeneration !== null,
    ).length;
    const taskChunks = chunkAreaPreparationRows(streetReconcile.inserts, options.chunkBytes);
    const taskDeleteChunks = chunkAreaPreparationRows(streetReconcile.deleteIds, options.chunkBytes);
    const houseChunks = chunkAreaPreparationRows(prepared.houseTasks, options.chunkBytes);
    if (taskChunks.length + taskDeleteChunks.length + houseChunks.length > AREA_PREPARATION_MAX_INSERT_CHUNKS) {
      throw new PreparationFailure(
        "area_preparation_too_many_features",
        "Die vorbereitete Task-Menge überschreitet die atomare Publish-Grenze.",
      );
    }
    const writeToken = (options.randomUUID ?? (() => crypto.randomUUID()))();
    const geometryJson = JSON.stringify(area.geometry);
    const guard = publishGuardBindings({
      campaignId,
      areaId,
      writeToken,
      generation,
      geometryHash,
      geometryJson,
    });
    const nextRevision = snapshot.revision + 1;
    const afterSnapshot: CampaignSnapshot = {
      ...snapshot,
      revision: nextRevision,
      tasks: streetReconcile.afterTasks,
      houseTasks: [
        ...(snapshot.houseTasks ?? []).filter((task) =>
          !(task.areaId === areaId && task.areaPreparationGeneration !== null && task.status === "open"),
        ),
        ...prepared.houseTasks,
      ],
    };
    const syncChanges = (await hasRxdbSyncSchema(db))
      ? rxdbChangeFeedEntriesForSnapshotDelta(snapshot, afterSnapshot)
      : [];
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE campaigns
           SET revision = ?, write_token = ?, updated_at = ?
           WHERE id = ? AND revision = ?
             AND ${stateGuardSql()}
             AND EXISTS (
               SELECT 1 FROM areas WHERE id = ? AND campaign_id = ? AND geometry_json = ?
             )
             AND ${automaticWorkGuardSql()}`,
        )
        .bind(
          nextRevision,
          writeToken,
          now,
          campaignId,
          snapshot.revision,
          campaignId,
          areaId,
          generation,
          geometryHash,
          areaId,
          campaignId,
          geometryJson,
          campaignId,
          areaId,
          campaignId,
          areaId,
        ),
      db
        .prepare(
          `DELETE FROM house_tasks
           WHERE campaign_id = ? AND area_id = ?
             AND area_preparation_generation IS NOT NULL AND status = 'open'
             AND ${publishGuardSql()}`,
        )
        .bind(campaignId, areaId, ...guard),
      ...taskDeleteChunks.map((chunk) => tasksDeleteStatement(db, chunk, campaignId, areaId, guard)),
      ...taskChunks.map((chunk) => tasksInsertStatement(db, chunk, guard)),
      ...houseChunks.map((chunk) => houseTasksInsertStatement(db, chunk, guard)),
      db
        .prepare(
          `UPDATE area_task_preparations
           SET status = 'ready', road_count = ?, house_count = ?, source_timestamp = ?,
               ready_at = ?, failed_at = NULL, last_error_code = NULL, updated_at = ?
           WHERE campaign_id = ? AND area_id = ? AND generation = ? AND geometry_hash = ?
             AND status = 'pending' AND ${publishGuardSql()}`,
        )
        .bind(
          roadCount,
          prepared.houseTasks.length,
          osm.sourceTimestamp,
          now,
          now,
          campaignId,
          areaId,
          generation,
          geometryHash,
          ...guard,
        ),
    ];
    if (syncChanges.length > 0) {
      statements.push(
        ...rxdbChangeFeedStatements(db, campaignId, writeToken, now, syncChanges),
      );
    }
    const results = await db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      const workStarted = await areaHasStartedAutomaticWork(db, campaignId, areaId);
      const code: AreaPreparationFailureCode = workStarted
        ? "area_preparation_work_started"
        : "area_preparation_stale";
      await markPreparationFailed(db, {
        campaignId,
        areaId,
        generation,
        geometryHash,
        code,
        now,
      });
      return workStarted
        ? { outcome: "failed", code }
        : { outcome: "stale", code: "area_preparation_stale" };
    }
    void Promise.resolve(options.onCommitted?.()).catch(() => undefined);
    return {
      outcome: "ready",
      roadCount,
      houseCount: prepared.houseTasks.length,
      generation,
    };
  } catch (error) {
    const code = failureCode(error);
    await markPreparationFailed(db, { campaignId, areaId, generation, geometryHash, code, now });
    return { outcome: "failed", code };
  }
}

/** Starts and, when claimed, completes a server-owned Area preparation job. */
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
  if (state?.status === "ready" && state.geometryHash === geometryHash) {
    return { schemaAvailable: true as const, shouldStart: false, state: publicState(state) };
  }
  if (state && isFreshPending(state, geometryHash, now)) {
    return { schemaAvailable: true as const, shouldStart: false, state: publicState(state) };
  }
  if (await areaHasStartedAutomaticWork(db, campaignId, area.id)) {
    return { schemaAvailable: true as const, shouldStart: false, state: publicState(state) };
  }
  return { schemaAvailable: true as const, shouldStart: true, state: publicState(state) };
}
