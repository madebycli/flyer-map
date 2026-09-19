import type { DistributionTask, HouseTask } from '../../src/domain/campaign.ts';
import type { AreaTaskPreparationOptions, AreaTaskPreparationRun, PrepareAreaTasksResult } from '../areaTaskPreparation.ts';
import { loadCampaignSnapshot, type D1DatabaseLike } from '../campaignRepository.ts';
import { requestDatabase } from '../requestDatabase.ts';
import { addressBuildings } from './addresses.ts';
import { hasBaseStorage, restoreManualHouseParents } from './baseStorage.ts';
import { associateHouses, buildRoadNetwork, eligibleRoad, interiorPoint, polygonOwnsPoint } from './geometry.ts';
import { persistNetworkSnapshot } from './persistence.ts';
import { reconcileServerPreparedStreetTasks, sha256Hex } from './reconcile.ts';
import {
  loadStreetEngineV3Source,
  resolveStreetEngineV3Manifest,
  type StreetEngineV3Bucket,
} from './v3SourceRuntime.ts';

const V3_ENGINE_VERSION = 'sourcepack-v3' as const;
const MAX_ROADS = 20_000;
const MAX_BUILDINGS = 20_000;
const RETRYABLE_ATTEMPTS = 3;

type V3Metrics = {
  engineVersion: typeof V3_ENGINE_VERSION;
  manifestHash?: string;
  sourcePackVersion?: string;
  algorithmVersion?: string;
  sourceTimestamp?: string;
  selectedShardIds?: string[];
  shardCount?: number;
  objectGets?: number;
  compressedBytes?: number;
  decodedBytes?: number;
  cacheHits?: number;
  cacheMisses?: number;
  legacyOverpassRequests: 0;
  activeMs?: number;
  sourceMs?: number;
  graphMs?: number;
  addressMs?: number;
  linkMs?: number;
  publishMs?: number;
  sourceRoads?: number;
  graphCandidateRoads?: number;
  roads?: number;
  sourceBuildings?: number;
  sourceAddressNodes?: number;
  areaAddressableBuildings?: number;
  buildings?: number;
  addressableBuildings?: number;
  houses?: number;
  resultHash?: string;
  lastError?: { phase: string; cursor: number; code: string; attempt: number };
};

type V3Job = {
  generation: string;
  phase: string;
  cursor: number;
  lease: string | null;
  lease_until: string | null;
  attempts: number;
  metrics_json: string;
};

export type StreetEngineV3PreparationOptions = AreaTaskPreparationOptions & {
  streetEngineVersion?: 'v2' | typeof V3_ENGINE_VERSION;
  streetEngineV3Bucket?: StreetEngineV3Bucket;
  streetEngineV3Channel?: string;
};

function errorCode(error: unknown) {
  if (error instanceof Error && error.message === 'graph_build_budget') return 'street_engine_v3_graph_build_budget';
  if (error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)) return error.message;
  return 'street_engine_v3_source_unavailable';
}

function retryable(code: string) {
  return code === 'street_engine_v3_source_unavailable';
}

function normalizedStreetName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('de').replace(/[\s.]+/g, ' ').trim();
}

async function preparedHouses(input: {
  campaignId: string;
  areaId: string;
  generation: string;
  timestamp: string;
  area: AreaTaskPreparationRun['area'];
  buildings: ReturnType<typeof addressBuildings>;
  roads: DistributionTask[];
}) {
  const houses: HouseTask[] = [];
  const addresses = new Map<string, string>();
  for (const building of input.buildings) {
    const point = interiorPoint(building.geometry);
    if (!polygonOwnsPoint(input.area.geometry, point)) continue;
    const id = `task_house_auto_${await sha256Hex(JSON.stringify({
      campaignId: input.campaignId,
      areaId: input.areaId,
      osmId: building.osmId,
      ...(building.identityAddress ? { address: building.identityAddress } : {}),
    }))}`;
    houses.push({
      id,
      campaignId: input.campaignId,
      areaId: input.areaId,
      taskType: 'house',
      label: building.address.label,
      geometry: building.geometry,
      source: { dataset: 'OpenStreetMap', objectType: 'way', objectIds: [building.osmId] },
      areaPreparationGeneration: input.generation,
      parentStreetTaskId: null,
      status: 'open',
      completedAt: null,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
    const street = building.tags['addr:street'];
    if (street) addresses.set(id, normalizedStreetName(street));
  }
  const rawAddresses = new Map<string, string>();
  for (const [id, street] of addresses) rawAddresses.set(id, street);
  return associateHouses(input.roads, houses, rawAddresses);
}

async function resultHash(tasks: DistributionTask[], houses: HouseTask[]) {
  return sha256Hex(JSON.stringify({
    tasks: tasks.map((task) => ({ id: task.id, geometry: task.geometry, network: task.network })).sort((a, b) => a.id.localeCompare(b.id)),
    houses: houses.map((house) => ({ id: house.id, geometry: house.geometry, parentStreetTaskId: house.parentStreetTaskId, roadPosition: house.roadPosition })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

async function failPreparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  lease: string,
  metrics: V3Metrics,
  code: string,
  attempts: number,
  now: string,
) {
  metrics.lastError = { phase: 'v3-source', cursor: 0, code, attempt: attempts };
  await db.batch([
    db.prepare(`UPDATE street_network_jobs
      SET phase='failed',lease=NULL,lease_until=NULL,attempts=?,error_code=?,metrics_json=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
      .bind(attempts, code, JSON.stringify(metrics), run.campaignId, run.areaId, run.generation, lease),
    db.prepare(`UPDATE area_task_preparations
      SET status='failed',last_error_code='area_preparation_osm_failed',failed_at=?,updated_at=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'`)
      .bind(now, now, run.campaignId, run.areaId, run.generation),
  ]);
}

export async function runStreetEngineV3Preparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: StreetEngineV3PreparationOptions,
): Promise<PrepareAreaTasksResult> {
  db = requestDatabase(db);
  if (options.streetEngineVersion !== V3_ENGINE_VERSION || !options.streetEngineV3Bucket) {
    return { outcome: 'failed', code: 'area_preparation_osm_failed' };
  }
  const channel = options.streetEngineV3Channel ?? 'beta';
  const now = (options.now?.() ?? new Date()).toISOString();
  const stepStarted = performance.now();

  const prior = await db.prepare(
    'SELECT generation,phase,cursor,lease,lease_until,attempts,metrics_json FROM street_network_jobs WHERE campaign_id=? AND area_id=?',
  ).bind(run.campaignId, run.areaId).first<V3Job>();
  let metrics: V3Metrics = prior?.generation === run.generation
    ? { engineVersion: V3_ENGINE_VERSION, legacyOverpassRequests: 0, ...JSON.parse(prior.metrics_json || '{}') }
    : { engineVersion: V3_ENGINE_VERSION, legacyOverpassRequests: 0 };

  if (!metrics.manifestHash) {
    try {
      const resolved = await resolveStreetEngineV3Manifest(options.streetEngineV3Bucket, channel);
      metrics.manifestHash = resolved.manifestHash;
      metrics.sourcePackVersion = resolved.manifest.sourcePackVersion;
      metrics.algorithmVersion = resolved.manifest.algorithmVersion;
      metrics.sourceTimestamp = resolved.manifest.source.timestamp;
      metrics.objectGets = resolved.objectGets;
    } catch (error) {
      const code = errorCode(error);
      await db.batch([
        db.prepare(`INSERT INTO street_network_jobs(campaign_id,area_id,generation,geometry_json,phase,cursor,attempts,error_code,metrics_json)
          VALUES(?,?,?,?, 'failed',0,1,?,?)
          ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation,geometry_json=excluded.geometry_json,phase='failed',cursor=0,lease=NULL,lease_until=NULL,attempts=1,error_code=excluded.error_code,metrics_json=excluded.metrics_json`)
          .bind(run.campaignId, run.areaId, run.generation, JSON.stringify(run.area.geometry), code, JSON.stringify({ ...metrics, lastError: { phase: 'v3-source', cursor: 0, code, attempt: 1 } })),
        db.prepare(`UPDATE area_task_preparations SET status='failed',last_error_code='area_preparation_osm_failed',failed_at=?,updated_at=? WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'`)
          .bind(now, now, run.campaignId, run.areaId, run.generation),
      ]);
      return { outcome: 'failed', code: 'area_preparation_osm_failed' };
    }
  }

  await db.batch([
    db.prepare(`INSERT INTO street_network_jobs(campaign_id,area_id,generation,geometry_json,phase,cursor,attempts,error_code,metrics_json)
      SELECT ?,?,?,?,'v3-source',0,0,NULL,?
      WHERE EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')
      ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation,geometry_json=excluded.geometry_json,phase='v3-source',cursor=0,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=excluded.metrics_json
      WHERE street_network_jobs.generation<>excluded.generation`)
      .bind(run.campaignId, run.areaId, run.generation, JSON.stringify(run.area.geometry), JSON.stringify(metrics), run.campaignId, run.areaId, run.generation),
  ]);

  const lease = crypto.randomUUID();
  const claimed = await db.batch([
    db.prepare(`UPDATE street_network_jobs SET lease=?,lease_until=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND phase<>'ready'
        AND (lease_until IS NULL OR lease_until<=?)
        AND EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')`)
      .bind(lease, new Date(Date.parse(now) + 60_000).toISOString(), run.campaignId, run.areaId, run.generation, now, run.campaignId, run.areaId, run.generation),
  ]);
  if (claimed[0]?.meta?.changes !== 1) return { outcome: 'pending' };

  const job = await db.prepare(
    'SELECT generation,phase,cursor,lease,lease_until,attempts,metrics_json FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?',
  ).bind(run.campaignId, run.areaId, run.generation, lease).first<V3Job>();
  if (!job) return { outcome: 'pending' };
  metrics = { engineVersion: V3_ENGINE_VERSION, legacyOverpassRequests: 0, ...JSON.parse(job.metrics_json || '{}') };

  try {
    const sourceStarted = performance.now();
    const source = await loadStreetEngineV3Source({
      bucket: options.streetEngineV3Bucket,
      channel,
      area: run.area.geometry,
      pinnedManifestHash: metrics.manifestHash,
    });
    metrics.sourceMs = performance.now() - sourceStarted;
    Object.assign(metrics, source.diagnostics);
    metrics.objectGets = (metrics.objectGets ?? 0) + source.diagnostics.objectGets;
    metrics.sourceRoads = source.roads.length;
    metrics.sourceBuildings = source.buildings.length;
    metrics.sourceAddressNodes = source.addressNodes.length;

    // Source-pack byte budgets protect runtime input size. Product entity
    // limits belong to the generated graph/House outputs, not every raw OSM
    // feature that happens to share an intersecting source shard.
    const graphSourceRoads = source.roads.filter((road) => eligibleRoad(road.tags));
    metrics.graphCandidateRoads = graphSourceRoads.length;

    const graphStarted = performance.now();
    const roads = await buildRoadNetwork({
      roads: graphSourceRoads,
      area: run.area.geometry,
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      timestamp: now,
      maxTasks: options.maxRoadFragments ?? MAX_ROADS,
    });
    metrics.graphMs = performance.now() - graphStarted;
    metrics.roads = roads.length;

    const addressStarted = performance.now();
    const addressed = addressBuildings(source.buildings, source.addressNodes);
    const areaAddressed = addressed.filter((building) =>
      polygonOwnsPoint(run.area.geometry, interiorPoint(building.geometry)),
    );
    metrics.addressMs = performance.now() - addressStarted;
    metrics.buildings = source.buildings.length;
    metrics.addressableBuildings = addressed.length;
    metrics.areaAddressableBuildings = areaAddressed.length;
    if (areaAddressed.length > (options.maxBuildings ?? MAX_BUILDINGS)) throw new Error('street_engine_v3_house_budget');

    const linkStarted = performance.now();
    const houses = await preparedHouses({
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      timestamp: now,
      area: run.area,
      buildings: areaAddressed,
      roads,
    });
    metrics.linkMs = performance.now() - linkStarted;
    metrics.houses = houses.length;

    const before = await loadCampaignSnapshot(db, run.campaignId, { includeCollection: false, areaId: run.areaId });
    if (!before) throw new Error('street_engine_v3_campaign_missing');
    const currentArea = before.areas.find((area) => area.id === run.areaId);
    if (!currentArea || JSON.stringify(currentArea.geometry) !== JSON.stringify(run.area.geometry)) {
      throw new Error('street_engine_v3_stale_geometry');
    }
    const reconcile = await reconcileServerPreparedStreetTasks({
      existingTasks: before.tasks,
      preparedFragments: [],
      preparedTasks: roads,
      campaignId: run.campaignId,
      areaId: run.areaId,
      generation: run.generation,
      timestamp: now,
      allowRemovedWork: await hasBaseStorage(db),
    });
    if (reconcile.outcome !== 'ready') throw new Error('area_preparation_work_started');

    const oldHouses = new Map((before.houseTasks ?? []).map((house) => [house.id, house]));
    let houseTasks = [
      ...(before.houseTasks ?? []).filter((house) => house.areaId !== run.areaId || !house.areaPreparationGeneration),
      ...houses.map((house) => {
        const priorHouse = oldHouses.get(house.id);
        return priorHouse
          ? { ...house, label: priorHouse.label, status: priorHouse.status, completedAt: priorHouse.completedAt, createdAt: priorHouse.createdAt }
          : house;
      }),
    ];
    if (await hasBaseStorage(db)) houseTasks = await restoreManualHouseParents(db, run.campaignId, houseTasks, reconcile.afterTasks);

    metrics.resultHash = await resultHash(reconcile.afterTasks.filter((task) => task.areaId === run.areaId), houseTasks.filter((house) => house.areaId === run.areaId));
    const publishStarted = performance.now();
    const published = await persistNetworkSnapshot(db, before, { ...before, tasks: reconcile.afterTasks, houseTasks }, {
      areaId: run.areaId,
      generation: run.generation,
      preparing: true,
      timestamp: now,
      sourceTimestamp: source.manifest.source.timestamp,
      lease,
    });
    if (!published.committed) throw new Error('street_engine_v3_publish_stale');
    metrics.publishMs = performance.now() - publishStarted;
    metrics.activeMs = (metrics.activeMs ?? 0) + performance.now() - stepStarted;
    await db.batch([
      db.prepare(`UPDATE street_network_jobs SET phase='ready',cursor=0,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=?
        WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
        .bind(JSON.stringify(metrics), run.campaignId, run.areaId, run.generation, lease),
    ]);
    try { await options.onCommitted?.(db); } catch { /* canonical feed is already durable */ }
    try {
      options.onProgress?.(run.area, {
        status: 'ready',
        roadCount: roads.length,
        houseCount: houses.length,
        sourceTimestamp: source.manifest.source.timestamp,
        errorCode: null,
        updatedAt: now,
      });
    } catch { /* diagnostics push is best effort */ }
    return { outcome: 'ready', roadCount: roads.length, houseCount: houses.length, generation: run.generation };
  } catch (error) {
    const code = errorCode(error);
    const attempts = job.attempts + 1;
    metrics.activeMs = (metrics.activeMs ?? 0) + performance.now() - stepStarted;
    metrics.lastError = { phase: 'v3-source', cursor: 0, code, attempt: attempts };
    if (retryable(code) && attempts < RETRYABLE_ATTEMPTS) {
      await db.batch([
        db.prepare(`UPDATE street_network_jobs SET lease=NULL,lease_until=?,attempts=?,error_code=?,metrics_json=?
          WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`)
          .bind(new Date(Date.parse(now) + 1_000 * 2 ** attempts).toISOString(), attempts, code, JSON.stringify(metrics), run.campaignId, run.areaId, run.generation, lease),
      ]);
      return { outcome: 'pending' };
    }
    await failPreparation(db, run, lease, metrics, code, attempts, now);
    return { outcome: 'failed', code: 'area_preparation_osm_failed' };
  }
}
