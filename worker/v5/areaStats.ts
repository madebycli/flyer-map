import type { AccessContext } from '../access.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { fail, ID, isRecord, json, readableAreasClause, resolveArea } from './shared.ts';

const MAX_UNITS = 800;
const MAX_COUNT = 10_000_000;
const UNIT = /^[A-Za-z0-9._:-]{1,160}(~[0-9]{1,4})?$/u;

/**
 * PUT /areas/stats — a device that derived units reports their sizes: `{ units: [{ unit, area, packVersion, houses, segments }] }`.
 * Admins only: the numbers describe public map data, but a wrong one would skew everybody's overview. Counts of a pack version that is no longer
 * the current one are ignored when read (`getProgress`).
 */
export async function putAreaStats(db: D1DatabaseLike, access: AccessContext, campaignId: string, request: Request, now: number): Promise<Response> {
  if (access.role !== 'admin') return fail(403, 'forbidden', 'Nur Admins dürfen Gebietsgrößen melden.');
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'unsupported_media_type', 'JSON erwartet.');
  let body: unknown;
  try { body = await request.json(); } catch { return fail(400, 'invalid_json', 'Ungültiges JSON.'); }
  const units = isRecord(body) && Array.isArray(body.units) ? body.units : null;
  if (!units || !units.length || units.length > MAX_UNITS) return fail(400, 'invalid_units', `1 bis ${MAX_UNITS} Einheiten erwartet.`);
  const rows: { unit: string; area: string; version: number; houses: number; segments: number }[] = [];
  for (const u of units) {
    if (!isRecord(u) || typeof u.unit !== 'string' || typeof u.area !== 'string' || !UNIT.test(u.unit) || !ID.test(u.area)) return fail(400, 'invalid_units', 'Einheit ungültig.');
    if (u.unit !== u.area && !u.unit.startsWith(`${u.area}~`)) return fail(400, 'invalid_units', 'Einheit gehört nicht zum Gebiet.');
    const [version, houses, segments] = [u.packVersion, u.houses, u.segments];
    if (![version, houses, segments].every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_COUNT)) return fail(400, 'invalid_units', 'Zahlen ungültig.');
    rows.push({ unit: u.unit, area: u.area, version: version as number, houses: houses as number, segments: segments as number });
  }
  for (const area of new Set(rows.map((r) => r.area))) if (!(await resolveArea(db, campaignId, area))) return fail(404, 'not_found', 'Gebiet nicht gefunden.');
  const at = new Date(now).toISOString();
  await db.batch(rows.map((r) => db.prepare(
    `INSERT INTO v5_area_stats (campaign_id, unit_id, area_id, pack_version, houses, segments, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, unit_id) DO UPDATE SET area_id = excluded.area_id, pack_version = excluded.pack_version, houses = excluded.houses, segments = excluded.segments, reported_at = excluded.reported_at`,
  ).bind(campaignId, r.unit, r.area, r.version, r.houses, r.segments, at)));
  return json({ ok: true, units: rows.length });
}

export type AreaProgress = { houses: number; segments: number; units: number; completed: number; later: number; notDeliverable: number };

/**
 * GET /progress — per Gebiet the person may read: reported size (only while the Gebiet's pack version is the one reported for; a big Gebiet's version is the one of its marker row, see `completeParts`) and how many houses are done / later / not deliverable.
 * One aggregate each, so the numbers cost the same whatever the size of the city is for the device.
 */
export async function getProgress(db: D1DatabaseLike, access: AccessContext, campaignId: string): Promise<Response> {
  const scope = readableAreasClause(access, campaignId);
  const sizes = (await db.prepare(
    `SELECT s.area_id AS area_id, SUM(s.houses) AS houses, SUM(s.segments) AS segments, COUNT(*) AS units
       FROM v5_area_stats s JOIN v5_pack_meta m ON m.campaign_id = s.campaign_id AND m.area_id = s.area_id AND m.version = s.pack_version
      WHERE s.campaign_id = ?${scope.sql.replaceAll('area_id', 's.area_id')} GROUP BY s.area_id`,
  ).bind(campaignId, ...scope.params).all<{ area_id: string; houses: number; segments: number; units: number }>()).results;
  const done = (await db.prepare(
    `SELECT area_id, status, COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND key LIKE 'h:%' AND status <> 'open'${scope.sql} GROUP BY area_id, status`,
  ).bind(campaignId, ...scope.params).all<{ area_id: string; status: string; n: number }>()).results;
  const areas: Record<string, AreaProgress> = {};
  const at = (id: string) => (areas[id] ??= { houses: 0, segments: 0, units: 0, completed: 0, later: 0, notDeliverable: 0 });
  for (const s of sizes) Object.assign(at(s.area_id), { houses: s.houses, segments: s.segments, units: s.units });
  for (const d of done) { const a = at(d.area_id); if (d.status === 'completed') a.completed = d.n; else if (d.status === 'later') a.later = d.n; else if (d.status === 'not-deliverable') a.notDeliverable = d.n; }
  return json({ areas });
}
