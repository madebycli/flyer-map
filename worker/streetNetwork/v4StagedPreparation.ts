import type { DistributionTask, HouseTask, LngLat } from '../../src/domain/campaign.ts';
import type { StreetEngineV3SourceShard } from '../../src/domain/streetEngineV3SourcePack.ts';
import type { AreaTaskPreparationOptions, AreaTaskPreparationRun, PrepareAreaTasksResult } from '../areaTaskPreparation.ts';
import { preparationProgress } from '../areaTaskPreparation.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { requestDatabase } from '../requestDatabase.ts';
import { addressBuildings, type AddressBuilding, type AddressNode } from './addresses.ts';
import { boundedChunks, workBucket } from './baseStorage.ts';
import {
  associateHouses,
  buildRoadNetworkFromFragments,
  clipRoadNetworkFragments,
  eligibleRoad,
  interiorPoint,
  polygonOwnsPoint,
  roadFragmentNodeKeys,
  type RoadNetworkFragment,
} from './geometry.ts';
import { jsonChunks } from './persistence.ts';
import { sha256Hex } from './reconcile.ts';
import {
  loadStreetEngineV3SourceShard,
  resolveStreetEngineV3SourceSelection,
  type StreetEngineV3Bucket,
} from './v3SourceRuntime.ts';

const NODE_BUCKETS = 32;
const LINK_BUCKETS = 2;
const LINK_RADIUS_METERS = 110;
const V4_DEFAULT_MAX_STREETS = 100_000;
const V4_DEFAULT_MAX_HOUSES = 100_000;

type V4StagedJob = {
  generation: string;
  phase: string;
  cursor: number;
  lease: string | null;
  lease_until: string | null;
  attempts: number;
  error_code: string | null;
  metrics_json: string;
};

type V4StagedMetrics = {
  engineVersion: 'v4';
  sourcePolicy: 'immutable-source-pack/no-live-overpass';
  legacyOverpassRequests: 0;
  manifestHash?: string;
  sourcePackVersion?: string;
  algorithmVersion?: string;
  sourceTimestamp?: string;
  taskTimestamp?: string;
  selectedShardIds?: string[];
  shardCount?: number;
  objectGets?: number;
  compressedBytes?: number;
  decodedBytes?: number;
  sourceRoads?: number;
  graphCandidateRoads?: number;
  roads?: number;
  sourceBuildings?: number;
  buildings?: number;
  sourceAddressNodes?: number;
  sourceAddressableBuildings?: number;
  addressableBuildings?: number;
  areaAddressableBuildings?: number;
  linkCells?: string[];
  linkBucketCount?: number;
  houses?: number;
  activeMs?: number;
  sourceMs?: number;
  graphMs?: number;
  addressMs?: number;
  linkMs?: number;
  publishMs?: number;
  resultHash?: string;
  baseChunkCount?: number;
  baseHashes?: string[];
  feedChunkCount?: number;
  baseStep?: string;
  lastError?: { phase: string; cursor: number; code: string; attempt: number };
};

type BasePreparedEntity = DistributionTask | HouseTask;
type AddressCandidate = { building: ReturnType<typeof addressBuildings>[number]; ordinal: number };
type StagedBaseChunk = {
  hash: string;
  kind: 'street' | 'house';
  bucket: number;
  payload: string;
};
type StagedFeedChunk = {
  collection: 'streetTasks' | 'houseTasks';
  scope: string | null;
  id: string;
  payload: string;
};

function parsedMetrics(raw: string): V4StagedMetrics {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    ...parsed,
    engineVersion: 'v4',
    sourcePolicy: 'immutable-source-pack/no-live-overpass',
    legacyOverpassRequests: 0,
  } as V4StagedMetrics;
}

function normalizeCode(value: string) {
  return value.replace(/^street_engine_v3_/u, 'street_engine_v4_');
}

function phaseErrorCode(phase: string, error: unknown) {
  if (error instanceof Error && error.message === 'network_row_budget_exceeded') {
    return 'street_engine_v4_row_budget_exceeded';
  }
  if (error instanceof Error && error.message === 'graph_build_budget') {
    return 'street_engine_v4_graph_build_budget';
  }
  if (error instanceof Error && /^street_engine_v[34]_[a-z0-9_]+$/u.test(error.message)) {
    return normalizeCode(error.message);
  }
  if (phase === 'v4-plan' || phase === 'v4-source') return 'street_engine_v4_source_unavailable';
  if (phase.startsWith('v4-graph')) return 'street_engine_v4_graph_internal_failure';
  if (phase.startsWith('v4-address')) return 'street_engine_v4_address_internal_failure';
  if (phase === 'v4-link') return 'street_engine_v4_link_internal_failure';
  if (phase === 'v4-base' || phase === 'v4-publish') return 'street_engine_v4_publish_internal_failure';
  return 'street_engine_v4_internal_failure';
}

function retryable(phase: string, code: string) {
  return (phase === 'v4-plan' || phase === 'v4-source')
    && code === 'street_engine_v4_source_unavailable';
}

function key(index: number) {
  return String(index).padStart(6, '0');
}

function bucketKey(index: number) {
  return String(index).padStart(2, '0');
}

function stableBucket(value: string, buckets: number) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % buckets;
}

function spatialCell(point: LngLat) {
  return `${Math.floor(point[0] * 100)}:${Math.floor(point[1] * 100)}`;
}

function taskSpatialCells(task: DistributionTask) {
  const points = task.geometry.coordinates;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
  const dy = LINK_RADIUS_METERS / 110_000;
  const dx = dy / Math.max(0.01, Math.cos(lat * Math.PI / 180));
  const minX = Math.min(...points.map((point) => point[0])) - dx;
  const maxX = Math.max(...points.map((point) => point[0])) + dx;
  const minY = Math.min(...points.map((point) => point[1])) - dy;
  const maxY = Math.max(...points.map((point) => point[1])) + dy;
  const cells: string[] = [];
  for (let y = Math.floor(minY * 100); y <= Math.floor(maxY * 100); y++) {
    for (let x = Math.floor(minX * 100); x <= Math.floor(maxX * 100); x++) {
      cells.push(`${x}:${y}`);
      if (cells.length > 256) throw new Error('street_engine_v4_edge_spatial_budget');
    }
  }
  return cells;
}

async function staged<T>(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  kind: string,
  prefix?: string,
): Promise<T[]> {
  const values: unknown[] = [run.campaignId, run.areaId, run.generation, kind];
  let sql = 'SELECT payload_json FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=? AND kind=?';
  if (prefix !== undefined) {
    sql += ' AND chunk_key LIKE ?';
    values.push(`${prefix}%`);
  }
  sql += ' ORDER BY chunk_key';
  const rows = await db.prepare(sql).bind(...values).all<{ payload_json: string }>();
  return rows.results.flatMap((row) => JSON.parse(row.payload_json) as T[]);
}

async function stageRows(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  lease: string,
  kind: string,
  rowKey: string,
  rows: readonly unknown[],
) {
  const chunks = jsonChunks(rows);
  const prefix = `${rowKey}:`;
  await db.batch([
    db.prepare(`DELETE FROM street_network_staging
      WHERE campaign_id=? AND area_id=? AND generation=? AND kind=? AND chunk_key LIKE ?
        AND EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)`)
      .bind(
        run.campaignId, run.areaId, run.generation, kind, `${prefix}%`,
        run.campaignId, run.areaId, run.generation, lease,
      ),
  ]);
  for (let start = 0; start < chunks.length; start += 30) {
    const statements = chunks.slice(start, start + 30).map((chunk, offset) =>
      db.prepare(`INSERT INTO street_network_staging(campaign_id,area_id,generation,kind,chunk_key,payload_json)
        SELECT ?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)
        ON CONFLICT(campaign_id,area_id,generation,kind,chunk_key)
        DO UPDATE SET payload_json=excluded.payload_json`)
        .bind(
          run.campaignId,
          run.areaId,
          run.generation,
          kind,
          `${prefix}${String(start + offset).padStart(6, '0')}`,
          JSON.stringify(chunk),
          run.campaignId,
          run.areaId,
          run.generation,
          lease,
        ),
    );
    if (statements.length) await db.batch(statements);
  }
}

async function stageGroups(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  lease: string,
  kind: string,
  owner: string,
  groups: Map<string, unknown[]>,
) {
  // A source shard can populate every node bucket. One DELETE per bucket plus
  // one INSERT per bucket exceeds the Free D1 50-query alarm limit before the
  // first shard can checkpoint, leaving the runner to exhaust crash recovery.
  // Clear this owner's prior partial work once, then write deterministic keys.
  await db.batch([
    db.prepare(`DELETE FROM street_network_staging
      WHERE campaign_id=? AND area_id=? AND generation=? AND kind=?
        AND chunk_key LIKE ?
        AND EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)`)
      .bind(
        run.campaignId, run.areaId, run.generation, kind, `%:${owner}:%`,
        run.campaignId, run.areaId, run.generation, lease,
      ),
  ]);
  const chunks = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([group, rows]) => jsonChunks(rows).map((chunk, index) =>
      ({ chunk_key: `${group}:${owner}:${String(index).padStart(6, '0')}`, payload: JSON.stringify(chunk) }),
    ));
  // json_each expands many small buckets in one bounded D1 statement. A
  // payload remains below the 2-MB D1 string limit even after JSON escaping.
  for (const part of jsonChunks(chunks, 900_000)) {
    await db.batch([
      db.prepare(`INSERT INTO street_network_staging(campaign_id,area_id,generation,kind,chunk_key,payload_json)
        SELECT ?,?,?,?,json_extract(value,'$.chunk_key'),json_extract(value,'$.payload')
        FROM json_each(?)
        WHERE EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)
        ON CONFLICT(campaign_id,area_id,generation,kind,chunk_key)
        DO UPDATE SET payload_json=excluded.payload_json`)
        .bind(
          run.campaignId, run.areaId, run.generation, kind, JSON.stringify(part),
          run.campaignId, run.areaId, run.generation, lease,
        ),
    ]);
  }
}

async function loadPlan(db: D1DatabaseLike, run: AreaTaskPreparationRun) {
  return staged<StreetEngineV3SourceShard>(db, run, 'v4-plan', 'selected:');
}

async function generationTimestamp(db: D1DatabaseLike, run: AreaTaskPreparationRun) {
  const row = await db.prepare(`SELECT started_at FROM area_task_preparations
    WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'`)
    .bind(run.campaignId, run.areaId, run.generation).first<{ started_at: string | null }>();
  if (!row) throw new Error('street_engine_v4_generation_stale');
  return row.started_at ?? run.now;
}

async function loadAllAddressNodes(db: D1DatabaseLike, run: AreaTaskPreparationRun) {
  return staged<AddressNode>(db, run, 'v4-address-nodes');
}

async function loadNodeUsage(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  fragments: RoadNetworkFragment[],
) {
  const wanted = new Set(fragments.flatMap(roadFragmentNodeKeys));
  const buckets = [...new Set([...wanted].map((node) => stableBucket(node, NODE_BUCKETS)))];
  const usage = new Map<string, number>();
  // Read a few buckets per D1 query. A road shard can touch all 32 buckets;
  // one query per bucket plus staging and runner bookkeeping can exceed the
  // same 50-query invocation budget after the graph step already checkpointed.
  for (let start = 0; start < buckets.length; start += 8) {
    const part = buckets.slice(start, start + 8);
    const conditions = part.map(() => 'chunk_key LIKE ?').join(' OR ');
    const rows = await db.prepare(`SELECT payload_json FROM street_network_staging
      WHERE campaign_id=? AND area_id=? AND generation=? AND kind='v4-node-usage'
        AND (${conditions}) ORDER BY chunk_key`)
      .bind(run.campaignId, run.areaId, run.generation, ...part.map((bucket) => `${bucketKey(bucket)}:%`))
      .all<{ payload_json: string }>();
    for (const row of rows.results) {
      for (const [node, count] of JSON.parse(row.payload_json) as [string, number][]) {
        if (wanted.has(node)) usage.set(node, count);
      }
    }
  }
  return usage;
}

function visibleWithOverlay<T extends BasePreparedEntity>(
  entity: T,
  work: Record<string, unknown> | undefined,
): T {
  if (!work) return entity;
  const coverage = Array.isArray(work.coverage) ? work.coverage : undefined;
  return {
    ...entity,
    ...(typeof work.label === 'string' ? { label: work.label } : {}),
    ...(typeof work.status === 'string' ? { status: work.status as T['status'] } : {}),
    ...('completedAt' in work ? { completedAt: work.completedAt as T['completedAt'] } : {}),
    ...(typeof work.createdAt === 'string' ? { createdAt: work.createdAt } : {}),
    ...(typeof work.updatedAt === 'string' ? { updatedAt: work.updatedAt } : {}),
    ...(entity.taskType === 'street' && entity.network && coverage
      ? { network: { ...entity.network, coverage: coverage as NonNullable<DistributionTask['network']>['coverage'] } }
      : {}),
  } as T;
}

function stableBaseEntity<T extends BasePreparedEntity>(entity: T, prior?: BasePreparedEntity): T {
  return {
    ...entity,
    label: prior?.label ?? entity.label,
    status: 'open',
    completedAt: null,
    areaPreparationGeneration: null,
    updatedAt: prior?.updatedAt ?? entity.createdAt,
    ...(entity.taskType === 'street' && entity.network
      ? { network: { ...entity.network, coverage: [] } }
      : {}),
  } as T;
}

async function oldBaseBucket(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  kind: 'street' | 'house',
  bucket: number,
) {
  const rows = await db.prepare(
    `SELECT payload_json FROM street_base_chunks
      WHERE campaign_id=? AND area_id=? AND kind=? AND bucket=?`,
  ).bind(run.campaignId, run.areaId, kind, bucket).all<{ payload_json: string }>();
  return rows.results.flatMap((row) => JSON.parse(row.payload_json) as BasePreparedEntity[]);
}

async function overlayBucket(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  bucket: number,
) {
  const row = await db.prepare(
    'SELECT payload_json FROM street_work_overlays WHERE campaign_id=? AND area_id=? AND bucket=?',
  ).bind(run.campaignId, run.areaId, bucket).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as Record<string, Record<string, unknown>> : {};
}

async function oldGeneration(db: D1DatabaseLike, run: AreaTaskPreparationRun) {
  const row = await db.prepare(
    'SELECT generation FROM street_base_areas WHERE campaign_id=? AND area_id=?',
  ).bind(run.campaignId, run.areaId).first<{ generation: string }>();
  return row?.generation ?? null;
}

async function publishStaged(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  lease: string,
  metrics: V4StagedMetrics,
  now: string,
) {
  const token = crypto.randomUUID();
  metrics.resultHash ??= await sha256Hex(JSON.stringify([...(metrics.baseHashes ?? [])].sort()));
  const guard = 'EXISTS(SELECT 1 FROM campaigns WHERE id=? AND write_token=?)';
  const statements = [
    db.prepare(`UPDATE campaigns SET revision=revision+1,write_token=?,updated_at=?
      WHERE id=?
        AND EXISTS(SELECT 1 FROM areas WHERE id=? AND campaign_id=? AND geometry_json=?)
        AND EXISTS(SELECT 1 FROM area_task_preparations
          WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')
        AND EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)`)
      .bind(
        token, now, run.campaignId,
        run.areaId, run.campaignId, JSON.stringify(run.area.geometry),
        run.campaignId, run.areaId, run.generation,
        run.campaignId, run.areaId, run.generation, lease,
      ),
    db.prepare(`INSERT INTO street_base_chunks(campaign_id,area_id,content_hash,kind,bucket,payload_json)
      SELECT ?,?,json_extract(value,'$.hash'),json_extract(value,'$.kind'),json_extract(value,'$.bucket'),json_extract(value,'$.payload')
      FROM street_network_staging s,json_each(s.payload_json)
      WHERE s.campaign_id=? AND s.area_id=? AND s.generation=? AND s.kind='v4-base-ready' AND ${guard}
      ON CONFLICT(campaign_id,area_id,content_hash) DO UPDATE SET
        kind=excluded.kind,bucket=excluded.bucket,payload_json=excluded.payload_json`)
      .bind(
        run.campaignId, run.areaId,
        run.campaignId, run.areaId, run.generation,
        run.campaignId, token,
      ),
    db.prepare(`DELETE FROM street_base_chunks
      WHERE campaign_id=? AND area_id=?
        AND content_hash NOT IN(
          SELECT json_extract(value,'$.hash')
          FROM street_network_staging s,json_each(s.payload_json)
          WHERE s.campaign_id=? AND s.area_id=? AND s.generation=? AND s.kind='v4-base-ready'
        )
        AND ${guard}`)
      .bind(
        run.campaignId, run.areaId,
        run.campaignId, run.areaId, run.generation,
        run.campaignId, token,
      ),
    db.prepare(`INSERT INTO street_base_areas(campaign_id,area_id,generation)
      SELECT ?,?,? WHERE ${guard}
      ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation`)
      .bind(run.campaignId, run.areaId, run.generation, run.campaignId, token),
    db.prepare(`INSERT INTO campaign_sync_changes(
        campaign_id,collection_name,document_id,operation,scope_team_id,document_json,changed_at)
      SELECT ?,json_extract(value,'$.collection'),json_extract(value,'$.id'),'upsert',
        json_extract(value,'$.scope'),json_extract(value,'$.payload'),?
      FROM street_network_staging s,json_each(s.payload_json)
      WHERE s.campaign_id=? AND s.area_id=? AND s.generation=? AND s.kind='v4-feed' AND ${guard}`)
      .bind(
        run.campaignId, now,
        run.campaignId, run.areaId, run.generation,
        run.campaignId, token,
      ),
    db.prepare(`DELETE FROM house_tasks
      WHERE campaign_id=? AND area_id=? AND area_preparation_generation IS NOT NULL AND ${guard}`)
      .bind(run.campaignId, run.areaId, run.campaignId, token),
    db.prepare(`DELETE FROM tasks
      WHERE campaign_id=? AND area_id=? AND area_preparation_generation IS NOT NULL AND ${guard}`)
      .bind(run.campaignId, run.areaId, run.campaignId, token),
    db.prepare(`UPDATE area_task_preparations SET
        status='ready',source_timestamp=?,road_count=?,house_count=?,ready_at=?,failed_at=NULL,updated_at=?,last_error_code=NULL
      WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending' AND ${guard}`)
      .bind(
        metrics.sourceTimestamp ?? null,
        metrics.roads ?? 0,
        metrics.houses ?? 0,
        now, now,
        run.campaignId, run.areaId, run.generation,
        run.campaignId, token,
      ),
    db.prepare(`UPDATE street_network_jobs SET
        phase='ready',cursor=0,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND lease=? AND ${guard}`)
      .bind(
        JSON.stringify(metrics),
        run.campaignId, run.areaId, run.generation, lease,
        run.campaignId, token,
      ),
    db.prepare(`DELETE FROM street_network_staging
      WHERE campaign_id=? AND area_id=? AND generation=? AND ${guard}`)
      .bind(run.campaignId, run.areaId, run.generation, run.campaignId, token),
  ];
  const result = await db.batch(statements);
  return result[0]?.meta?.changes === 1;
}

export async function runStreetEngineV4StagedPreparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: AreaTaskPreparationOptions & {
    streetEngineV4Bucket: StreetEngineV3Bucket;
    streetEngineV4Channel?: string;
    v4LinkBuckets?: number;
  },
): Promise<PrepareAreaTasksResult> {
  db = requestDatabase(db);
  const now = (options.now?.() ?? new Date()).toISOString();
  const scope = [run.campaignId, run.areaId, run.generation] as const;

  const initialized = await db.batch([
    db.prepare(`INSERT INTO street_network_jobs(
        campaign_id,area_id,generation,geometry_json,phase,cursor,lease,lease_until,attempts,error_code,metrics_json)
      SELECT ?,?,?,?,'v4-plan',0,NULL,NULL,0,NULL,?
      WHERE EXISTS(SELECT 1 FROM area_task_preparations
        WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')
      ON CONFLICT(campaign_id,area_id) DO UPDATE SET
        generation=excluded.generation,geometry_json=excluded.geometry_json,phase='v4-plan',cursor=0,
        lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=excluded.metrics_json
      WHERE street_network_jobs.generation<>excluded.generation`)
      .bind(
        ...scope,
        JSON.stringify(run.area.geometry),
        JSON.stringify({
          engineVersion: 'v4',
          sourcePolicy: 'immutable-source-pack/no-live-overpass',
          legacyOverpassRequests: 0,
        }),
        ...scope,
      ),
  ]);
  if (initialized[0]?.meta?.changes === 1) {
    await db.batch([
      db.prepare(`DELETE FROM street_network_staging
        WHERE campaign_id=? AND area_id=? AND generation<>?`).bind(...scope),
    ]);
  }

  const lease = crypto.randomUUID();
  const claimed = await db.batch([
    db.prepare(`UPDATE street_network_jobs SET lease=?,lease_until=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND phase<>'ready'
        AND (lease_until IS NULL OR lease_until<=?)
        AND EXISTS(SELECT 1 FROM area_task_preparations
          WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')`)
      .bind(
        lease,
        new Date(Date.parse(now) + 60_000).toISOString(),
        ...scope,
        now,
        ...scope,
      ),
  ]);
  if (claimed[0]?.meta?.changes !== 1) return { outcome: 'pending' };

  const job = await db.prepare(
    'SELECT generation,phase,cursor,lease,lease_until,attempts,error_code,metrics_json FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?',
  ).bind(...scope, lease).first<V4StagedJob>();
  if (!job) return { outcome: 'pending' };

  const stepStarted = performance.now();
  const metrics = parsedMetrics(job.metrics_json);
  let phase = job.phase;
  let cursor = job.cursor;

  try {
    if (phase === 'v4-plan') {
      const begin = performance.now();
      metrics.taskTimestamp = await generationTimestamp(db, run);
      const resolved = await resolveStreetEngineV3SourceSelection({
        bucket: options.streetEngineV4Bucket,
        channel: options.streetEngineV4Channel ?? 'beta',
        area: run.area.geometry,
      });
      metrics.manifestHash = resolved.manifestHash;
      metrics.sourcePackVersion = resolved.manifest.sourcePackVersion;
      metrics.algorithmVersion = resolved.manifest.algorithmVersion.replace(/^v3-/u, 'v4-');
      metrics.sourceTimestamp = resolved.manifest.source.timestamp;
      metrics.selectedShardIds = resolved.selection.shards.map((shard) => shard.id);
      metrics.shardCount = resolved.selection.shards.length;
      metrics.objectGets = resolved.objectGets;
      metrics.compressedBytes = 0;
      metrics.decodedBytes = 0;
      metrics.sourceRoads = 0;
      metrics.graphCandidateRoads = 0;
      metrics.sourceBuildings = 0;
      metrics.buildings = 0;
      metrics.sourceAddressNodes = 0;
      metrics.roads = 0;
      metrics.sourceAddressableBuildings = 0;
      metrics.addressableBuildings = 0;
      metrics.areaAddressableBuildings = 0;
      metrics.linkCells = [];
      metrics.houses = 0;
      const linkBuckets = options.v4LinkBuckets ?? LINK_BUCKETS;
      if (!Number.isSafeInteger(linkBuckets) || linkBuckets < 1 || linkBuckets > 8) {
        throw new Error('street_engine_v4_link_bucket_invalid');
      }
      metrics.linkBucketCount = linkBuckets;
      await stageRows(db, run, lease, 'v4-plan', 'selected', resolved.selection.shards);
      metrics.sourceMs = (metrics.sourceMs ?? 0) + performance.now() - begin;
      phase = 'v4-source';
      cursor = 0;
    } else if (phase === 'v4-source') {
      const begin = performance.now();
      let plan = await loadPlan(db, run);
      // A retry may inherit a pre-staging V4 source job. Its selection was
      // recorded in metrics, but no durable plan rows existed yet. Recreate
      // the immutable selection without resetting the current attempt count.
      if (!plan.length && cursor === 0) {
        metrics.taskTimestamp ??= await generationTimestamp(db, run);
        const resolved = await resolveStreetEngineV3SourceSelection({
          bucket: options.streetEngineV4Bucket,
          channel: options.streetEngineV4Channel ?? 'beta',
          area: run.area.geometry,
        });
        if (metrics.manifestHash && metrics.manifestHash !== resolved.manifestHash) {
          throw new Error('street_engine_v4_source_manifest_changed');
        }
        metrics.manifestHash = resolved.manifestHash;
        metrics.sourcePackVersion = resolved.manifest.sourcePackVersion;
        metrics.algorithmVersion = resolved.manifest.algorithmVersion.replace(/^v3-/u, 'v4-');
        metrics.sourceTimestamp = resolved.manifest.source.timestamp;
        metrics.selectedShardIds = resolved.selection.shards.map((shard) => shard.id);
        metrics.shardCount = resolved.selection.shards.length;
        metrics.objectGets = (metrics.objectGets ?? 0) + resolved.objectGets;
        await stageRows(db, run, lease, 'v4-plan', 'selected', resolved.selection.shards);
        plan = resolved.selection.shards;
      }
      const shard = plan[cursor];
      if (!shard) throw new Error('street_engine_v4_source_plan_invalid');
      const decoded = await loadStreetEngineV3SourceShard(options.streetEngineV4Bucket, shard);
      const fragments = clipRoadNetworkFragments(decoded.payload.roads, run.area.geometry);
      await stageRows(db, run, lease, 'v4-fragments', key(cursor), fragments);
      await stageRows(db, run, lease, 'v4-buildings', key(cursor), decoded.payload.buildings);
      await stageRows(db, run, lease, 'v4-address-nodes', key(cursor), decoded.payload.addressNodes);

      const nodeGroups = new Map<string, unknown[]>();
      for (const fragment of fragments) {
        for (const node of roadFragmentNodeKeys(fragment)) {
          const group = bucketKey(stableBucket(node, NODE_BUCKETS));
          const rows = nodeGroups.get(group) ?? [];
          rows.push(node);
          nodeGroups.set(group, rows);
        }
      }
      await stageGroups(db, run, lease, 'v4-node-raw', key(cursor), nodeGroups);

      metrics.objectGets = (metrics.objectGets ?? 0) + decoded.objectGets;
      metrics.compressedBytes = (metrics.compressedBytes ?? 0) + decoded.compressedBytes;
      metrics.decodedBytes = (metrics.decodedBytes ?? 0) + decoded.decodedBytes;
      metrics.sourceRoads = (metrics.sourceRoads ?? 0) + decoded.payload.roads.length;
      metrics.graphCandidateRoads = (metrics.graphCandidateRoads ?? 0)
        + decoded.payload.roads.filter((road) => eligibleRoad(road.tags)).length;
      metrics.sourceBuildings = (metrics.sourceBuildings ?? 0) + decoded.payload.buildings.length;
      metrics.buildings = metrics.sourceBuildings;
      metrics.sourceAddressNodes = (metrics.sourceAddressNodes ?? 0) + decoded.payload.addressNodes.length;
      metrics.sourceMs = (metrics.sourceMs ?? 0) + performance.now() - begin;

      cursor += 1;
      if (cursor >= plan.length) {
        phase = 'v4-node-usage';
        cursor = 0;
      }
    } else if (phase === 'v4-node-usage') {
      const prefix = `${bucketKey(cursor)}:`;
      const nodes = await staged<string>(db, run, 'v4-node-raw', prefix);
      const counts = new Map<string, number>();
      for (const node of nodes) counts.set(node, Math.min(2, (counts.get(node) ?? 0) + 1));
      await stageRows(
        db,
        run,
        lease,
        'v4-node-usage',
        bucketKey(cursor),
        [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      );
      cursor += 1;
      if (cursor >= NODE_BUCKETS) {
        phase = 'v4-graph';
        cursor = 0;
      }
    } else if (phase === 'v4-graph') {
      const begin = performance.now();
      const plan = await loadPlan(db, run);
      const fragments = await staged<RoadNetworkFragment>(db, run, 'v4-fragments', `${key(cursor)}:`);
      const usage = await loadNodeUsage(db, run, fragments);
      const remaining = (options.maxRoadFragments ?? V4_DEFAULT_MAX_STREETS) - (metrics.roads ?? 0);
      if (remaining < 0) throw new Error('street_engine_v4_graph_build_budget');
      const tasks = await buildRoadNetworkFromFragments({
        fragments,
        nodeUsage: usage,
        campaignId: run.campaignId,
        areaId: run.areaId,
        generation: run.generation,
        timestamp: metrics.taskTimestamp ??= await generationTimestamp(db, run),
        maxTasks: remaining,
      });
      const nextRoads = (metrics.roads ?? 0) + tasks.length;
      if (nextRoads > (options.maxRoadFragments ?? V4_DEFAULT_MAX_STREETS)) {
        throw new Error('street_engine_v4_graph_build_budget');
      }
      await stageRows(db, run, lease, 'v4-edges', key(cursor), tasks);

      const workGroups = new Map<string, unknown[]>();
      const spatialGroups = new Map<string, unknown[]>();
      for (const task of tasks) {
        const work = bucketKey(workBucket(task.id));
        const workRows = workGroups.get(work) ?? [];
        workRows.push(task);
        workGroups.set(work, workRows);
        for (const cell of taskSpatialCells(task)) {
          const rows = spatialGroups.get(cell) ?? [];
          rows.push(task);
          spatialGroups.set(cell, rows);
        }
      }
      await stageGroups(db, run, lease, 'v4-edge-work', key(cursor), workGroups);
      await stageGroups(db, run, lease, 'v4-edge-space', key(cursor), spatialGroups);
      metrics.roads = nextRoads;
      metrics.graphMs = (metrics.graphMs ?? 0) + performance.now() - begin;

      cursor += 1;
      if (cursor >= plan.length) {
        phase = 'v4-address';
        cursor = 0;
      }
    } else if (phase === 'v4-address') {
      const begin = performance.now();
      const plan = await loadPlan(db, run);
      const buildings = await staged<AddressBuilding>(db, run, 'v4-buildings', `${key(cursor)}:`);
      const nodes = await loadAllAddressNodes(db, run);
      const addressed = addressBuildings(buildings, nodes);
      // addressBuildings deduplicates within one shard. Its global key winner
      // must be chosen across all shards before we count or publish Houses.
      const groups = new Map<string, unknown[]>();
      const ordinals = new Map<number, number>();
      for (const building of addressed) {
        const ordinal = ordinals.get(building.osmId) ?? 0;
        ordinals.set(building.osmId, ordinal + 1);
        const addressKey = building.address.key ?? `building:${building.osmId}:${building.address.number}`;
        const group = bucketKey(stableBucket(addressKey, NODE_BUCKETS));
        const rows = groups.get(group) ?? [];
        rows.push({ building, ordinal } satisfies AddressCandidate);
        groups.set(group, rows);
      }
      await stageGroups(db, run, lease, 'v4-address-keys', key(cursor), groups);
      metrics.addressMs = (metrics.addressMs ?? 0) + performance.now() - begin;

      cursor += 1;
      if (cursor >= plan.length) {
        phase = 'v4-address-dedupe';
        cursor = 0;
      }
    } else if (phase === 'v4-address-dedupe') {
      const begin = performance.now();
      const candidates = await staged<AddressCandidate>(db, run, 'v4-address-keys', `${bucketKey(cursor)}:`);
      candidates.sort((left, right) => left.building.osmId - right.building.osmId
        || left.ordinal - right.ordinal);
      const seen = new Set<string>();
      const groups = new Map<string, unknown[]>();
      for (const candidate of candidates) {
        const building = candidate.building;
        const addressKey = building.address.key ?? `building:${building.osmId}:${building.address.number}`;
        if (seen.has(addressKey)) continue;
        seen.add(addressKey);
        const group = bucketKey(stableBucket(String(building.osmId), NODE_BUCKETS));
        const rows = groups.get(group) ?? [];
        rows.push(candidate);
        groups.set(group, rows);
      }
      await stageGroups(db, run, lease, 'v4-address-winners', bucketKey(cursor), groups);
      metrics.addressMs = (metrics.addressMs ?? 0) + performance.now() - begin;
      cursor += 1;
      if (cursor >= NODE_BUCKETS) {
        phase = 'v4-address-final';
        cursor = 0;
      }
    } else if (phase === 'v4-address-final') {
      const begin = performance.now();
      const winners = await staged<AddressCandidate>(db, run, 'v4-address-winners', `${bucketKey(cursor)}:`);
      winners.sort((left, right) => left.building.osmId - right.building.osmId
        || left.ordinal - right.ordinal);
      const emitted = new Set<number>();
      const owned: ReturnType<typeof addressBuildings> = [];
      for (const { building } of winners) {
        const first = !emitted.has(building.osmId);
        emitted.add(building.osmId);
        const addressKey = building.address.key ?? `building:${building.osmId}:${building.address.number}`;
        const resolved = { ...building, identityAddress: first ? null : addressKey };
        if (polygonOwnsPoint(run.area.geometry, interiorPoint(resolved.geometry))) owned.push(resolved);
      }
      const sourceAddressed = (metrics.sourceAddressableBuildings ?? 0) + winners.length;
      const areaAddressed = (metrics.areaAddressableBuildings ?? 0) + owned.length;
      if (areaAddressed > (options.maxBuildings ?? V4_DEFAULT_MAX_HOUSES)) {
        throw new Error('street_engine_v4_house_budget');
      }
      metrics.sourceAddressableBuildings = sourceAddressed;
      metrics.addressableBuildings = sourceAddressed;
      metrics.areaAddressableBuildings = areaAddressed;
      const groups = new Map<string, unknown[]>();
      for (const building of owned) {
        const cell = spatialCell(interiorPoint(building.geometry));
        const group = `${cell}:${bucketKey(stableBucket(String(building.osmId), metrics.linkBucketCount ?? LINK_BUCKETS))}`;
        const rows = groups.get(group) ?? [];
        rows.push(building);
        groups.set(group, rows);
      }
      await stageGroups(db, run, lease, 'v4-targets', key(cursor), groups);
      metrics.linkCells = [...new Set([...(metrics.linkCells ?? []), ...groups.keys()])].sort();
      metrics.addressMs = (metrics.addressMs ?? 0) + performance.now() - begin;
      cursor += 1;
      if (cursor >= NODE_BUCKETS) {
        phase = 'v4-link';
        cursor = 0;
      }
    } else if (phase === 'v4-link') {
      const begin = performance.now();
      const group = metrics.linkCells?.[cursor];
      if (!group) {
        phase = 'v4-base';
        cursor = 0;
      } else {
      const cell = group.slice(0, group.lastIndexOf(':'));
      const targets = await staged<ReturnType<typeof addressBuildings>[number]>(
        db, run, 'v4-targets', `${group}:`,
      );
      const houses: HouseTask[] = [];
      const addresses = new Map<string, string>();
      const cells = new Set<string>();
      for (const building of targets) {
        const point = interiorPoint(building.geometry);
        cells.add(spatialCell(point));
        const id = `task_house_auto_${await sha256Hex(JSON.stringify({
          campaignId: run.campaignId,
          areaId: run.areaId,
          osmId: building.osmId,
          ...(building.identityAddress ? { address: building.identityAddress } : {}),
        }))}`;
        houses.push({
          id,
          campaignId: run.campaignId,
          areaId: run.areaId,
          taskType: 'house',
          label: building.address.label,
          geometry: building.geometry,
          source: { dataset: 'OpenStreetMap', objectType: 'way', objectIds: [building.osmId] },
          areaPreparationGeneration: run.generation,
          parentStreetTaskId: null,
          status: 'open',
          completedAt: null,
          createdAt: metrics.taskTimestamp ??= await generationTimestamp(db, run),
          updatedAt: metrics.taskTimestamp,
        });
        if (building.tags['addr:street']) addresses.set(id, building.tags['addr:street']);
      }

      const edgeMap = new Map<string, DistributionTask>();
      for (const cell of cells) {
        const edges = await staged<DistributionTask>(db, run, 'v4-edge-space', `${cell}:`);
        for (const edge of edges) edgeMap.set(edge.id, edge);
      }
      const linked = associateHouses([...edgeMap.values()], houses, addresses);
      const nextHouses = (metrics.houses ?? 0) + linked.length;
      if (nextHouses > (options.maxBuildings ?? V4_DEFAULT_MAX_HOUSES)) {
        throw new Error('street_engine_v4_house_budget');
      }
      await stageRows(db, run, lease, 'v4-houses', key(cursor), linked);
      const workGroups = new Map<string, unknown[]>();
      for (const house of linked) {
        const work = bucketKey(workBucket(house.id));
        const rows = workGroups.get(work) ?? [];
        rows.push(house);
        workGroups.set(work, rows);
      }
      await stageGroups(db, run, lease, 'v4-house-work', key(cursor), workGroups);
      metrics.houses = nextHouses;
      metrics.linkMs = (metrics.linkMs ?? 0) + performance.now() - begin;

      cursor += 1;
      if (cursor >= (metrics.linkCells?.length ?? 0)) {
        phase = 'v4-base';
        cursor = 0;
      }
      }
    } else if (phase === 'v4-base') {
      const kind: 'street' | 'house' = cursor < 16 ? 'street' : 'house';
      const bucket = cursor % 16;
      const stageKind = kind === 'street' ? 'v4-edge-work' : 'v4-house-work';
      metrics.baseStep = 'load-generated';
      const generated = await staged<BasePreparedEntity>(db, run, stageKind, `${bucketKey(bucket)}:`);
      generated.sort((left, right) => left.id.localeCompare(right.id));
      metrics.baseStep = 'load-existing';
      const old = await oldBaseBucket(db, run, kind, bucket);
      const oldById = new Map(old.map((entity) => [entity.id, entity]));
      const newIds = new Set(generated.map((entity) => entity.id));
      const overlay = await overlayBucket(db, run, bucket);
      const previousGeneration = await oldGeneration(db, run);

      metrics.baseStep = 'build-base';
      const stable = generated.map((entity) => stableBaseEntity(entity, oldById.get(entity.id)));
      const baseRows: StagedBaseChunk[] = [];
      for (const part of boundedChunks(stable)) {
        const payload = JSON.stringify(part);
        baseRows.push({
          hash: await sha256Hex(payload),
          kind,
          bucket,
          payload,
        });
      }
      metrics.baseStep = 'write-base';
      await stageRows(db, run, lease, 'v4-base-ready', `${kind}:${bucketKey(bucket)}`, baseRows);
      metrics.baseChunkCount = (metrics.baseChunkCount ?? 0) + baseRows.length;
      metrics.baseHashes = [...(metrics.baseHashes ?? []), ...baseRows.map((row) => row.hash)];

      const visibleNew = stable.map((entity) =>
        visibleWithOverlay(
          { ...entity, areaPreparationGeneration: run.generation } as BasePreparedEntity,
          overlay[entity.id],
        ),
      );
      const deleted = old
        .filter((entity) => !newIds.has(entity.id))
        .map((entity) => ({
          ...visibleWithOverlay(
            { ...entity, areaPreparationGeneration: previousGeneration } as BasePreparedEntity,
            overlay[entity.id],
          ),
          _deleted: true,
        }));
      const documents = [...visibleNew, ...deleted];
      metrics.baseStep = 'build-feed';
      const feedRows: StagedFeedChunk[] = boundedChunks(documents, 220_000).map((part) => ({
        collection: kind === 'street' ? 'streetTasks' : 'houseTasks',
        scope: run.area.teamId ?? null,
        id: part[0]?.id ?? `${kind}:${bucket}`,
        payload: JSON.stringify({ documents: part }),
      }));
      metrics.baseStep = 'write-feed';
      await stageRows(db, run, lease, 'v4-feed', `${kind}:${bucketKey(bucket)}`, feedRows);
      metrics.feedChunkCount = (metrics.feedChunkCount ?? 0) + feedRows.length;
      delete metrics.baseStep;

      cursor += 1;
      if (cursor >= 32) {
        metrics.resultHash = await sha256Hex(JSON.stringify([...(metrics.baseHashes ?? [])].sort()));
        phase = 'v4-publish';
        cursor = 0;
      }
    } else if (phase === 'v4-publish') {
      const begin = performance.now();
      metrics.activeMs = (metrics.activeMs ?? 0) + performance.now() - stepStarted;
      const committed = await publishStaged(db, run, lease, metrics, now);
      if (!committed) throw new Error('street_engine_v4_publish_stale');
      const publishElapsed = performance.now() - begin;
      metrics.publishMs = (metrics.publishMs ?? 0) + publishElapsed;
      metrics.activeMs += publishElapsed;
      // The product commit is already atomic. Refresh diagnostic timing only;
      // failure to record it cannot undo the published generation.
      try {
        await db.batch([
          db.prepare(`UPDATE street_network_jobs SET metrics_json=?
            WHERE campaign_id=? AND area_id=? AND generation=? AND phase='ready'
              AND json_extract(metrics_json,'$.resultHash')=?`)
            .bind(JSON.stringify(metrics), run.campaignId, run.areaId, run.generation, metrics.resultHash),
        ]);
      } catch { /* best effort diagnostic */ }
      try { await options.onCommitted?.(db); } catch { /* canonical feed is already durable */ }
      try {
        options.onProgress?.(run.area, {
          status: 'ready',
          roadCount: metrics.roads ?? 0,
          houseCount: metrics.houses ?? 0,
          sourceTimestamp: metrics.sourceTimestamp ?? null,
          errorCode: null,
          updatedAt: now,
          progress: preparationProgress('ready', 0, metrics.shardCount ?? 1, {
            addressableBuildings: metrics.areaAddressableBuildings,
            linkCellCount: metrics.linkCells?.length,
          }, true),
        });
      } catch { /* best effort */ }
      return {
        outcome: 'ready',
        roadCount: metrics.roads ?? 0,
        houseCount: metrics.houses ?? 0,
        generation: run.generation,
      };
    } else if (phase === 'ready') {
      return {
        outcome: 'ready',
        roadCount: metrics.roads ?? 0,
        houseCount: metrics.houses ?? 0,
        generation: run.generation,
      };
    } else {
      throw new Error('street_engine_v4_phase_invalid');
    }

    metrics.activeMs = (metrics.activeMs ?? 0) + performance.now() - stepStarted;
    const checkpoint = await db.batch([
      db.prepare(`UPDATE street_network_jobs SET
          phase=?,cursor=?,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=?
        WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
        .bind(
          phase, cursor, JSON.stringify(metrics),
          run.campaignId, run.areaId, run.generation, lease,
        ),
    ]);
    if (checkpoint[0]?.meta?.changes === 1) {
      try {
        options.onProgress?.(run.area, {
          status: 'pending',
          roadCount: metrics.roads ?? 0,
          houseCount: metrics.houses ?? 0,
          sourceTimestamp: metrics.sourceTimestamp ?? null,
          errorCode: null,
          updatedAt: now,
          progress: preparationProgress(
            phase,
            cursor,
            metrics.shardCount ?? 1,
            { addressableBuildings: metrics.areaAddressableBuildings, linkCellCount: metrics.linkCells?.length },
            false,
          ),
        });
      } catch { /* best effort */ }
    }
    return { outcome: 'pending' };
  } catch (error) {
    metrics.activeMs = (metrics.activeMs ?? 0) + performance.now() - stepStarted;
    const code = phaseErrorCode(phase, error);
    const attempts = job.attempts + 1;
    metrics.lastError = { phase, cursor, code, attempt: attempts };
    if (retryable(phase, code) && attempts < 3) {
      await db.batch([
        db.prepare(`UPDATE street_network_jobs SET
            lease=NULL,lease_until=?,attempts=?,error_code=?,metrics_json=?
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
          .bind(
            new Date(Date.parse(now) + 1_000 * 2 ** attempts).toISOString(),
            attempts, code, JSON.stringify(metrics),
            run.campaignId, run.areaId, run.generation, lease,
          ),
      ]);
      return { outcome: 'pending' };
    }
    await db.batch([
      db.prepare(`UPDATE street_network_jobs SET
          phase='failed',cursor=?,lease=NULL,lease_until=NULL,attempts=?,error_code=?,metrics_json=?
        WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
        .bind(
          cursor, attempts, code, JSON.stringify(metrics),
          run.campaignId, run.areaId, run.generation, lease,
        ),
      db.prepare(`UPDATE area_task_preparations SET
          status='failed',last_error_code='area_preparation_osm_failed',failed_at=?,updated_at=?
        WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'`)
        .bind(now, now, run.campaignId, run.areaId, run.generation),
    ]);
    return { outcome: 'failed', code: 'area_preparation_osm_failed' };
  }
}
