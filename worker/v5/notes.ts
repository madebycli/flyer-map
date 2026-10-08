import { decodeClock } from '../../src/v5/store/hlc.ts';
import { NOTE_KEY, NOTE_TEXT_MAX, cleanText, isFlag } from '../../src/v5/notes/types.ts';
import type { AccessContext } from '../access.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { ID, canSeeArea, fail, isScoped, json, writesAllowed } from './shared.ts';

const MAX_NOTES_PER_PUSH = 50;
const MAX_BODY_BYTES = 64_000;
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

type Options = { now?: () => number };
type Row = { id: string; key: string; area_id: string; flag: string | null; body: string; rev: string; deleted: number; actor: string; seq: number };

export async function pullNotes(db: D1DatabaseLike, access: AccessContext, campaignId: string, url: URL, options: Options): Promise<Response> {
  const since = Math.max(0, Math.trunc(Number(url.searchParams.get('since') ?? '0')) || 0);
  const limit = Math.min(500, Math.max(1, Math.trunc(Number(url.searchParams.get('limit') ?? '500')) || 500));
  const scoped = isScoped(access);
  const rows = (await db.prepare(
    `SELECT id, key, area_id, flag, body, rev, deleted, actor, seq FROM v5_notes WHERE campaign_id = ? AND seq > ?${
      scoped ? ' AND area_id IN (SELECT id FROM areas WHERE campaign_id = ? AND team_id = ?)' : ''
    } ORDER BY seq ASC LIMIT ?`,
  ).bind(...(scoped ? [campaignId, since, campaignId, access.teamId, limit + 1] : [campaignId, since, limit + 1])).all<Row>()).results;
  const page = rows.slice(0, limit);
  return json({
    notes: page.map((r) => ({ id: r.id, key: r.key, area: r.area_id, flag: r.flag, text: r.body, rev: r.rev, deleted: r.deleted === 1, by: r.actor })),
    cursor: page.length ? page[page.length - 1].seq : since,
    more: rows.length > limit,
    serverNow: (options.now ?? Date.now)(),
  });
}

type Incoming = { id?: unknown; key?: unknown; area?: unknown; flag?: unknown; text?: unknown; rev?: unknown; deleted?: unknown };

export async function pushNotes(db: D1DatabaseLike, access: AccessContext, campaignId: string, request: Request, options: Options): Promise<Response> {
  if (!writesAllowed(access)) return fail(403, 'read_only', 'Diese Rolle darf keine Notizen schreiben.');
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'unsupported_media_type', 'JSON erwartet.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'Zu viele Notizen auf einmal.');
  let body: { notes?: Incoming[] };
  try { body = JSON.parse(text); } catch { return fail(400, 'invalid_json', 'Ungültiges JSON.'); }
  if (!Array.isArray(body.notes) || body.notes.length === 0 || body.notes.length > MAX_NOTES_PER_PUSH) return fail(400, 'invalid_notes', `1 bis ${MAX_NOTES_PER_PUSH} Notizen erwartet.`);

  const now = (options.now ?? Date.now)();
  const areaOk = new Map<string, boolean>();
  const accepted: string[] = [], rejected: { id: string; reason: string }[] = [];
  const latest = new Map<string, { id: string; key: string; area: string; flag: string | null; text: string; rev: string; deleted: boolean }>();
  for (const n of body.notes) {
    const id = typeof n.id === 'string' ? n.id : '';
    const reject = (reason: string) => rejected.push({ id, reason });
    const created = decodeClock(id), edited = typeof n.rev === 'string' ? decodeClock(n.rev) : null;
    if (!created || !edited || (n.rev as string) < id) { reject('bad_id'); continue; }
    if (edited.wall > now + FUTURE_SKEW_MS) { reject('clock_future'); continue; }
    if (typeof n.key !== 'string' || !NOTE_KEY.test(n.key)) { reject('bad_key'); continue; }
    if (typeof n.area !== 'string' || !ID.test(n.area)) { reject('bad_area'); continue; }
    if (n.key.startsWith('a:') && n.key !== `a:${n.area}`) { reject('bad_key'); continue; }
    if (n.flag !== null && n.flag !== undefined && !isFlag(n.flag)) { reject('bad_flag'); continue; }
    if (n.text !== undefined && (typeof n.text !== 'string' || n.text.length > NOTE_TEXT_MAX * 2)) { reject('bad_text'); continue; }
    const clean = cleanText(typeof n.text === 'string' ? n.text : '');
    const deleted = n.deleted === true;
    if (!deleted && !n.flag && clean === '') { reject('empty'); continue; }
    if (!areaOk.has(n.area)) areaOk.set(n.area, (await canSeeArea(db, access, campaignId, n.area)) !== null);
    if (!areaOk.get(n.area)) { reject('area_forbidden'); continue; }
    accepted.push(id);
    const prior = latest.get(id);
    if (!prior || prior.rev < (n.rev as string)) latest.set(id, { id, key: n.key, area: n.area, flag: (n.flag as string | null | undefined) ?? null, text: clean, rev: n.rev as string, deleted });
  }
  if (latest.size) {
    // A note never moves: its key and Area are fixed at creation, so a scoped writer cannot pull a foreign note into their Area.
    const ids = [...latest.keys()];
    const existing = new Map<string, { key: string; area: string }>();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const found = (await db.prepare(`SELECT id, key, area_id FROM v5_notes WHERE campaign_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(campaignId, ...chunk).all<{ id: string; key: string; area_id: string }>()).results;
      for (const row of found) existing.set(row.id, { key: row.key, area: row.area_id });
    }
    for (const [id, note] of [...latest]) {
      const current = existing.get(id);
      if (current && (current.key !== note.key || current.area !== note.area)) {
        latest.delete(id);
        accepted.splice(accepted.indexOf(id), 1);
        rejected.push({ id, reason: 'note_immutable' });
      }
    }
  }
  if (latest.size) {
    // Same rule as the status overlay: sequence numbers are allocated inside the atomic batch.
    const rows = [...latest.values()].sort((a, b) => (a.rev < b.rev ? -1 : a.rev > b.rev ? 1 : a.id < b.id ? -1 : 1));
    const actor = (access.label ?? access.grantId).slice(0, 80);
    const statements = [
      db.prepare('INSERT OR IGNORE INTO v5_note_counters (campaign_id, seq) VALUES (?, 0)').bind(campaignId),
      db.prepare('UPDATE v5_note_counters SET seq = seq + ? WHERE campaign_id = ?').bind(rows.length, campaignId),
    ];
    rows.forEach((r, i) => statements.push(db.prepare(
      `INSERT INTO v5_notes (campaign_id, id, key, area_id, flag, body, rev, deleted, actor, grant_id, seq)
       VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT seq FROM v5_note_counters WHERE campaign_id = ?) - ?)
       ON CONFLICT(campaign_id, id) DO UPDATE SET flag = excluded.flag, body = excluded.body, rev = excluded.rev, deleted = excluded.deleted, seq = excluded.seq
       WHERE excluded.rev > v5_notes.rev AND v5_notes.key = excluded.key AND v5_notes.area_id = excluded.area_id`,
    ).bind(campaignId, r.id, r.key, r.area, r.flag, r.text, r.rev, r.deleted ? 1 : 0, actor, access.grantId, campaignId, rows.length - (i + 1))));
    try { await db.batch(statements); } catch { return fail(500, 'write_failed', 'Notizen konnten nicht gespeichert werden.'); }
  }
  return json({ accepted, rejected });
}
