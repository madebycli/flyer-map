import type { AccessContext } from '../access.ts';
import { loadCanonicalArea, type D1DatabaseLike } from '../campaignRepository.ts';

export const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { ...init, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...init.headers } });
export const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, { status });

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

/** Roles that may write something at all; which Areas they may write in is decided per Area (`canWriteArea`). */
export const writesAllowed = (a: AccessContext) => a.role === 'admin' || a.role === 'team-editor' || a.role === 'collection-collector';
/** Roles whose reads and writes are bound to Areas they are entitled to (admins and viewers see everything). */
export const isScoped = (a: AccessContext) => a.role === 'team-editor' || a.role === 'collection-collector';

type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };
/** An Area of either kind: distribution Areas belong to a team, collection Areas are claimed by a Run. */
export type AreaRef =
  | { source: 'distribution'; id: string; name: string; teamId: string; geometry: Polygon; updatedAt: string }
  | { source: 'collection'; id: string; name: string; status: string; runId: string | null; geometry: Polygon; updatedAt: string };

export async function resolveArea(db: D1DatabaseLike, campaignId: string, areaId: string): Promise<AreaRef | null> {
  const distribution = await loadCanonicalArea(db, campaignId, areaId);
  if (distribution) return { source: 'distribution', id: distribution.id, name: distribution.name, teamId: distribution.teamId, geometry: distribution.geometry as Polygon, updatedAt: distribution.updatedAt };
  try {
    const row = await db.prepare('SELECT id, name, status, run_id, geometry_json, updated_at FROM collection_areas WHERE campaign_id = ? AND id = ?')
      .bind(campaignId, areaId).first<{ id: string; name: string; status: string; run_id: string | null; geometry_json: string; updated_at: string }>();
    return row ? { source: 'collection', id: row.id, name: row.name, status: row.status, runId: row.run_id, geometry: JSON.parse(row.geometry_json) as Polygon, updatedAt: row.updated_at } : null;
  } catch { return null; /* collection tables not migrated: there are simply no collection Areas */ }
}

/** Reading: team members see their team's Areas, collectors the collection Areas (so they see who works where). */
export function canReadArea(access: AccessContext, area: AreaRef): boolean {
  if (area.source === 'distribution') return access.role !== 'collection-collector' && (!isScoped(access) || access.teamId === area.teamId);
  if (area.status === 'archived' && access.role !== 'admin') return false;
  return access.role === 'admin' || access.role === 'viewer' || access.role === 'collection-collector';
}

/** True when this collector is an active member of the active Run that holds the Area. */
async function collectorWorksIn(db: D1DatabaseLike, access: AccessContext, campaignId: string, area: Extract<AreaRef, { source: 'collection' }>): Promise<boolean> {
  if (!access.collectorId || !area.runId || (area.status !== 'claimed' && area.status !== 'in-progress')) return false;
  const row = await db.prepare(
    `SELECT 1 AS ok FROM collection_run_members m JOIN collection_runs r ON r.id = m.run_id AND r.campaign_id = m.campaign_id
      WHERE m.campaign_id = ? AND m.run_id = ? AND m.collector_id = ? AND m.left_at IS NULL AND r.status = 'active'`,
  ).bind(campaignId, area.runId, access.collectorId).first<{ ok: number }>();
  return !!row;
}

/** Writing: server-checked, never inferred from what the UI offers. */
export async function canWriteArea(db: D1DatabaseLike, access: AccessContext, campaignId: string, area: AreaRef): Promise<boolean> {
  if (!writesAllowed(access)) return false;
  if (area.source === 'distribution') return access.role !== 'collection-collector' && (!isScoped(access) || access.teamId === area.teamId);
  if (area.status === 'archived') return false;
  if (access.role === 'admin') return true;
  return access.role === 'collection-collector' && (await collectorWorksIn(db, access, campaignId, area));
}

/** SQL fragment restricting a table's `area_id` to what a caller may read; admins and viewers get no restriction. */
export function readableAreasClause(access: AccessContext, campaignId: string): { sql: string; params: unknown[] } {
  if (access.role === 'collection-collector') return { sql: " AND area_id IN (SELECT id FROM collection_areas WHERE campaign_id = ? AND status <> 'archived')", params: [campaignId] };
  if (isScoped(access)) return { sql: ' AND area_id IN (SELECT id FROM areas WHERE campaign_id = ? AND team_id = ?)', params: [campaignId, access.teamId] };
  return { sql: '', params: [] };
}
