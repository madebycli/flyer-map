import { decodeClock, encodeClock } from '../../src/v5/store/hlc.ts';
import type { AccessContext } from '../access.ts';
import type { D1DatabaseLike, D1PreparedStatement } from '../campaignRepository.ts';
import { fail, isRecord, json, resolveArea } from './shared.ts';

const MAX_PRUNE = 5000;
const PRUNE_CONFIRM_MIN = 20;
const PRUNE_CONFIRM_SHARE = 0.6;
const KEYS_PER_STATEMENT = 1000; // one JSON parameter per statement, ~30 bytes per key
const KEY = /^[sh]:[A-Za-z0-9#:._~@-]{1,80}$/u;
const ACTOR = 'Aufräumen';

/**
 * Clean-up never deletes a synced row: the other devices already hold its status and cursor, so a vanished row would stay on them
 * for good. It writes a tombstone instead (status `open`, which equals "no entry", under a newer id and sequence number), and the
 * normal pull carries it to everyone. The id sorts after the newest id it replaces, so last-writer-wins lets it win over exactly what
 * it removes and lets any edit made afterwards win over it.
 */
function tombstoneId(now: number, newest: string | null): string {
  const prior = newest ? decodeClock(newest) : null;
  if (!prior || prior.wall < now) return encodeClock({ wall: now, counter: 0, node: `srv${crypto.randomUUID().slice(0, 6)}` });
  return encodeClock({ wall: prior.wall, counter: prior.counter + 1, node: `srv${crypto.randomUUID().slice(0, 6)}` });
}

/** True while no Gebiet with this id exists, in the same statement that writes. A check made before the batch could be overtaken by a re-created Gebiet. */
async function goneGuard(db: D1DatabaseLike, campaignId: string, areaId: string): Promise<{ sql: string; params: unknown[] }> {
  let sql = ' AND NOT EXISTS (SELECT 1 FROM areas WHERE campaign_id = ? AND id = ?)';
  const params: unknown[] = [campaignId, areaId];
  try { await db.prepare('SELECT 1 FROM collection_areas LIMIT 1').first(); sql += ' AND NOT EXISTS (SELECT 1 FROM collection_areas WHERE campaign_id = ? AND id = ?)'; params.push(campaignId, areaId); }
  catch { /* collection tables not migrated: there are no collection Areas to guard */ }
  return { sql, params };
}

type Scope = { where: string; params: unknown[] };

/** Tombstones the rows of `table` matched by `scope`; sequence numbers are allocated inside the same atomic batch as the update. */
function tombstoneStatements(db: D1DatabaseLike, table: 'v5_state' | 'v5_notes', campaignId: string, scope: Scope, id: string, grantId: string): D1PreparedStatement[] {
  const counters = table === 'v5_state' ? 'v5_counters' : 'v5_note_counters';
  const idColumn = table === 'v5_state' ? 'key' : 'id';
  const set = table === 'v5_state'
    ? "status = 'open', op_id = ?, actor = ?, grant_id = ?"
    : "flag = NULL, body = '', deleted = 1, rev = ?, actor = ?, grant_id = ?";
  const eligible = `SELECT ${idColumn} AS k FROM ${table} WHERE ${scope.where}`;
  return [
    db.prepare(`INSERT OR IGNORE INTO ${counters} (campaign_id, seq) VALUES (?, 0)`).bind(campaignId),
    db.prepare(`UPDATE ${counters} SET seq = seq + (SELECT COUNT(*) FROM ${table} WHERE ${scope.where}) WHERE campaign_id = ?`).bind(...scope.params, campaignId),
    db.prepare(
      `WITH t AS MATERIALIZED (SELECT k, row_number() OVER (ORDER BY k) AS n, count(*) OVER () AS cnt FROM (${eligible}))
       UPDATE ${table} SET ${set}, seq = (SELECT seq FROM ${counters} WHERE campaign_id = ?) - t.cnt + t.n
       FROM t WHERE ${table}.campaign_id = ? AND ${table}.${idColumn} = t.k`,
    ).bind(...scope.params, id, ACTOR, grantId, campaignId, campaignId),
  ];
}

/**
 * "Gebiet bereinigen": after an Area was reshaped the engine derives a different set of keys. The client lists the keys of
 * that Area that no longer exist in what it derived; the server clears exactly those rows (and only rows of this Area).
 * Admin only: it is a bulk delete of shared progress.
 */
export async function pruneState(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string, request: Request, now: number): Promise<Response> {
  if (access.role !== 'admin') return fail(403, 'forbidden', 'Nur Admins dürfen ein Gebiet bereinigen.');
  const area = await resolveArea(db, campaignId, areaId);
  if (!area) return fail(404, 'not_found', 'Gebiet nicht gefunden.');
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'unsupported_media_type', 'JSON erwartet.');
  const text = await request.text();
  if (text.length > 200_000) return fail(413, 'too_large', 'Zu viele Einträge auf einmal.');
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail(400, 'invalid_json', 'Ungültiges JSON.'); }
  if (!isRecord(body)) return fail(400, 'invalid_json', 'JSON-Objekt erwartet.');
  if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > MAX_PRUNE || !body.keys.every((k) => typeof k === 'string' && KEY.test(k))) return fail(400, 'invalid_keys', `1 bis ${MAX_PRUNE} gültige Schlüssel erwartet.`);
  const keys = [...new Set(body.keys as string[])];
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_STATEMENT) chunks.push(keys.slice(i, i + KEYS_PER_STATEMENT));
  // Only rows that really belong to this Area, and still carry a status, are candidates; the reply names the ones really cleared.
  const found: { key: string; op_id: string }[] = [];
  for (const chunk of chunks) {
    found.push(...(await db.prepare("SELECT key, op_id FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open' AND key IN (SELECT value FROM json_each(?))").bind(campaignId, areaId, JSON.stringify(chunk)).all<{ key: string; op_id: string }>()).results);
  }
  // A clean-up that would wipe most of an Area is almost never intended (a partial map download, a wrong outline): it needs an explicit confirmation.
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open'").bind(campaignId, areaId).first<{ n: number }>())?.n ?? 0;
  if (body.confirm !== true && found.length > PRUNE_CONFIRM_MIN && found.length > total * PRUNE_CONFIRM_SHARE) {
    return json({ error: { code: 'prune_confirm_required', message: `Das würde ${found.length} von ${total} Markierungen dieses Gebiets entfernen. Bitte bestätigen.` }, matched: found.length, total }, { status: 409 });
  }
  if (!found.length) return json({ removed: 0, keys: [] });
  const newest = found.reduce((max, row) => (row.op_id > max ? row.op_id : max), '');
  const id = tombstoneId(now, newest);
  const statements: D1PreparedStatement[] = [];
  for (const chunk of chunks) {
    // `op_id <= newest` keeps an edit that arrived after the lookup above: it is newer than the tombstone would be.
    statements.push(...tombstoneStatements(db, 'v5_state', campaignId, {
      where: "campaign_id = ? AND area_id = ? AND status <> 'open' AND op_id <= ? AND key IN (SELECT value FROM json_each(?))",
      params: [campaignId, areaId, newest, JSON.stringify(chunk)],
    }, id, access.grantId));
  }
  // the first INSERT OR IGNORE per chunk is idempotent; one batch keeps allocation and update atomic
  await db.batch(statements);
  const cleared: string[] = [];
  for (const chunk of chunks) {
    cleared.push(...(await db.prepare('SELECT key FROM v5_state WHERE campaign_id = ? AND area_id = ? AND op_id = ? AND key IN (SELECT value FROM json_each(?))').bind(campaignId, areaId, id, JSON.stringify(chunk)).all<{ key: string }>()).results.map((r) => r.key));
  }
  return json({ removed: cleared.length, keys: cleared });
}

/**
 * After a Gebiet was deleted: everything v5 kept for it goes too (progress, notes, map data). Admin only, and only once the Gebiet
 * is really gone, so this can never be used to wipe a live Gebiet; the check sits in the same atomic batch as the writes.
 * Progress and notes become tombstones the other devices pull; the map data is deleted for good.
 */
export async function forgetArea(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string, now: number): Promise<Response> {
  if (access.role !== 'admin') return fail(403, 'forbidden', 'Nur Admins dürfen ein Gebiet endgültig entfernen.');
  if (await resolveArea(db, campaignId, areaId)) return fail(409, 'area_still_exists', 'Das Gebiet existiert noch. Erst löschen, dann aufräumen.');
  const guard = await goneGuard(db, campaignId, areaId);
  const newestState = (await db.prepare("SELECT MAX(op_id) AS m FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open'").bind(campaignId, areaId).first<{ m: string | null }>())?.m ?? null;
  const newestNote = (await db.prepare('SELECT MAX(rev) AS m FROM v5_notes WHERE campaign_id = ? AND area_id = ? AND deleted = 0').bind(campaignId, areaId).first<{ m: string | null }>())?.m ?? null;
  const statements: D1PreparedStatement[] = [];
  let stateAt = -1, notesAt = -1;
  if (newestState) {
    stateAt = statements.length + 2;
    statements.push(...tombstoneStatements(db, 'v5_state', campaignId, { where: `campaign_id = ? AND area_id = ? AND status <> 'open' AND op_id <= ?${guard.sql}`, params: [campaignId, areaId, newestState, ...guard.params] }, tombstoneId(now, newestState), access.grantId));
  }
  if (newestNote) {
    notesAt = statements.length + 2;
    statements.push(...tombstoneStatements(db, 'v5_notes', campaignId, { where: `campaign_id = ? AND area_id = ? AND deleted = 0 AND rev <= ?${guard.sql}`, params: [campaignId, areaId, newestNote, ...guard.params] }, tombstoneId(now, newestNote), access.grantId));
  }
  for (const table of ['v5_packs', 'v5_pack_meta', 'v5_pack_attempts']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE campaign_id = ? AND area_id = ?${guard.sql}`).bind(campaignId, areaId, ...guard.params));
  }
  const results = await db.batch(statements);
  return json({ removed: stateAt >= 0 ? results[stateAt]?.meta?.changes ?? 0 : 0, notes: notesAt >= 0 ? results[notesAt]?.meta?.changes ?? 0 : 0 });
}
