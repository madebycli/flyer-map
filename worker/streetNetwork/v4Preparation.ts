import type { AreaTaskPreparationOptions, AreaTaskPreparationRun, PrepareAreaTasksResult } from '../areaTaskPreparation.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { runStreetEngineV4StagedPreparation } from './v4StagedPreparation.ts';
import type { StreetEngineV3Bucket } from './v3SourceRuntime.ts';

export type StreetEngineV4Bucket = StreetEngineV3Bucket;

export type StreetEngineV4PreparationOptions = AreaTaskPreparationOptions & {
  streetEngineVersion?: 'legacy' | 'v4';
  streetEngineV4Bucket?: StreetEngineV4Bucket;
  streetEngineV4Channel?: string;
  v4LinkBuckets?: number;
};

function v4Code(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.replace(/^street_engine_v3_/u, 'street_engine_v4_');
}

function v4Phase(value: unknown) {
  return value === 'v3-source' ? 'v4-source' : value;
}

type V4RetryJob = {
  generation: string;
  phase: string;
  attempts: number;
  error_code: string | null;
  lease_until: string | null;
  metrics_json: string;
  preparation_started_at: string | null;
};

function parsedMetrics(raw: string) {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * A user retry keeps the same preparation generation. Old legacy failures and
 * terminal V4 failures must not carry their exhausted attempt/error/lease state
 * into the new V4 run. The runner can also fail the preparation while leaving
 * the V4 job mid-phase; a new started_at then invalidates its pinned source
 * manifest and partial staging. In-progress transient retries keep their state.
 */
async function resetV4RetryState(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: StreetEngineV4PreparationOptions,
  now: string,
) {
  const row = await db.prepare(`SELECT j.generation,j.phase,j.attempts,j.error_code,j.lease_until,
      j.metrics_json,p.started_at AS preparation_started_at
    FROM street_network_jobs j JOIN area_task_preparations p
      ON p.campaign_id=j.campaign_id AND p.area_id=j.area_id AND p.generation=j.generation
    WHERE j.campaign_id=? AND j.area_id=?`)
    .bind(run.campaignId, run.areaId).first<V4RetryJob>();
  if (!row || row.generation !== run.generation) return;

  const metrics = parsedMetrics(row.metrics_json);
  const currentV4 = metrics.engineVersion === 'v4';
  const terminalV4 = currentV4 && row.phase === 'failed';
  const legacyOrUnversioned = !currentV4;
  const restartedV4 = currentV4
    && typeof metrics.taskTimestamp === 'string'
    && typeof row.preparation_started_at === 'string'
    && metrics.taskTimestamp !== row.preparation_started_at;
  if (!terminalV4 && !legacyOrUnversioned && !restartedV4) return;

  const leaseUntil = row.lease_until ? Date.parse(row.lease_until) : 0;
  if (Number.isFinite(leaseUntil) && leaseUntil > Date.parse(now)) return;

  const baseline: Record<string, unknown> = {
    engineVersion: 'v4',
    sourcePolicy: 'immutable-source-pack/no-live-overpass',
    legacyOverpassRequests: 0,
    resetToken: crypto.randomUUID(),
  };
  const baselineJson = JSON.stringify(baseline);

  await db.batch([
    db.prepare(`UPDATE street_network_jobs
      SET phase='v4-plan',cursor=0,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=?
      WHERE campaign_id=? AND area_id=? AND generation=?
        AND phase=? AND phase<>'ready' AND metrics_json=?
        AND (lease_until IS NULL OR lease_until<=?)
        AND EXISTS(
          SELECT 1 FROM area_task_preparations
          WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'
            AND started_at IS ?
        )`)
      .bind(
        baselineJson,
        run.campaignId,
        run.areaId,
        run.generation,
        row.phase,
        row.metrics_json,
        now,
        run.campaignId,
        run.areaId,
        run.generation,
        row.preparation_started_at,
      ),
    db.prepare(`DELETE FROM street_network_staging
      WHERE campaign_id=? AND area_id=? AND generation=?
        AND EXISTS(SELECT 1 FROM street_network_jobs
          WHERE campaign_id=? AND area_id=? AND generation=? AND metrics_json=? AND lease IS NULL)`)
      .bind(run.campaignId, run.areaId, run.generation,
        run.campaignId, run.areaId, run.generation, baselineJson),
  ]);
}

function normalizeMetrics(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { engineVersion: 'v4', legacyOverpassRequests: 0 };
  }
  const metrics = { ...(value as Record<string, unknown>) };
  metrics.engineVersion = 'v4';
  metrics.legacyOverpassRequests = 0;
  if (typeof metrics.algorithmVersion === 'string') {
    metrics.algorithmVersion = metrics.algorithmVersion.replace(/^v3-/u, 'v4-');
  }
  if (metrics.lastError && typeof metrics.lastError === 'object' && !Array.isArray(metrics.lastError)) {
    const error = { ...(metrics.lastError as Record<string, unknown>) };
    error.phase = v4Phase(error.phase);
    error.code = v4Code(error.code);
    metrics.lastError = error;
  }
  return metrics;
}

async function normalizeDurableV4State(db: D1DatabaseLike, run: AreaTaskPreparationRun) {
  const row = await db.prepare(
    'SELECT phase,error_code,metrics_json FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=?',
  ).bind(run.campaignId, run.areaId, run.generation).first<{phase:string;error_code:string|null;metrics_json:string}>();
  if (!row) return;
  let parsed: unknown = {};
  try { parsed = JSON.parse(row.metrics_json || '{}'); } catch { parsed = {}; }
  if (row.phase !== 'v3-source' && !row.error_code?.startsWith('street_engine_v3_')
      && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).engineVersion === 'v4') return;
  const phase = String(v4Phase(row.phase) ?? row.phase);
  const errorCode = v4Code(row.error_code) as string | null;
  await db.batch([
    db.prepare(`UPDATE street_network_jobs
      SET phase=?,error_code=?,metrics_json=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND phase=? AND metrics_json=? AND error_code IS ?`)
      .bind(phase, errorCode, JSON.stringify(normalizeMetrics(parsed)),
        run.campaignId, run.areaId, run.generation, row.phase, row.metrics_json, row.error_code),
  ]);
}

async function failMissingSource(db: D1DatabaseLike, run: AreaTaskPreparationRun, now: string) {
  const code = 'street_engine_v4_source_binding_missing';
  const metrics = JSON.stringify({
    engineVersion: 'v4',
    legacyOverpassRequests: 0,
    lastError: { phase: 'v4-source', cursor: 0, code, attempt: 1 },
  });
  await db.batch([
    db.prepare(`INSERT INTO street_network_jobs(campaign_id,area_id,generation,geometry_json,phase,cursor,lease,lease_until,attempts,error_code,metrics_json)
      VALUES(?,?,?,?, 'failed',0,NULL,NULL,1,?,?)
      ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation,geometry_json=excluded.geometry_json,phase='failed',cursor=0,lease=NULL,lease_until=NULL,attempts=1,error_code=excluded.error_code,metrics_json=excluded.metrics_json`)
      .bind(run.campaignId, run.areaId, run.generation, JSON.stringify(run.area.geometry), code, metrics),
    db.prepare(`UPDATE area_task_preparations
      SET status='failed',last_error_code='area_preparation_osm_failed',failed_at=?,updated_at=?
      WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'`)
      .bind(now, now, run.campaignId, run.areaId, run.generation),
  ]);
}

/**
 * Street Engine V4 is provider-free at runtime. The immutable source-pack codec
 * is shared with the earlier experimental implementation, but V4 is the only
 * public engine identity and all durable diagnostics are normalized to V4.
 */
export async function runStreetEngineV4Preparation(
  db: D1DatabaseLike,
  run: AreaTaskPreparationRun,
  options: StreetEngineV4PreparationOptions,
): Promise<PrepareAreaTasksResult> {
  const now = (options.now?.() ?? new Date()).toISOString();
  if (options.streetEngineVersion !== 'v4' || !options.streetEngineV4Bucket) {
    await failMissingSource(db, run, now);
    return { outcome: 'failed', code: 'area_preparation_osm_failed' };
  }

  await resetV4RetryState(db, run, options, now);

  const result = await runStreetEngineV4StagedPreparation(db, run, {
    ...options,
    streetEngineV4Bucket: options.streetEngineV4Bucket,
    streetEngineV4Channel: options.streetEngineV4Channel ?? 'beta',
  });
  await normalizeDurableV4State(db, run);
  return result;
}
