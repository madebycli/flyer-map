import type { AreaTaskPreparationOptions, AreaTaskPreparationRun, PrepareAreaTasksResult } from '../areaTaskPreparation.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { runStreetEngineV3Preparation } from './v3Preparation.ts';
import type { StreetEngineV3Bucket } from './v3SourceRuntime.ts';

export type StreetEngineV4Bucket = StreetEngineV3Bucket;

export type StreetEngineV4PreparationOptions = AreaTaskPreparationOptions & {
  streetEngineVersion?: 'legacy' | 'v4';
  streetEngineV4Bucket?: StreetEngineV4Bucket;
  streetEngineV4Channel?: string;
};

function v4Code(value: unknown) {
  if (typeof value !== 'string') return value;
  return value.replace(/^street_engine_v3_/u, 'street_engine_v4_');
}

function v4Phase(value: unknown) {
  return value === 'v3-source' ? 'v4-source' : value;
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
  const phase = String(v4Phase(row.phase) ?? row.phase);
  const errorCode = v4Code(row.error_code) as string | null;
  await db.batch([
    db.prepare(`UPDATE street_network_jobs
      SET phase=?,error_code=?,metrics_json=?
      WHERE campaign_id=? AND area_id=? AND generation=?`)
      .bind(phase, errorCode, JSON.stringify(normalizeMetrics(parsed)), run.campaignId, run.areaId, run.generation),
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

  const result = await runStreetEngineV3Preparation(db, run, {
    ...options,
    streetEngineVersion: 'sourcepack-v3',
    streetEngineV3Bucket: options.streetEngineV4Bucket,
    streetEngineV3Channel: options.streetEngineV4Channel ?? 'beta',
  });
  await normalizeDurableV4State(db, run);
  return result;
}
