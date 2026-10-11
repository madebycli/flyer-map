import { randomSecret, sessionCookie, createSessionForGrant, resolveAccess, hashSecret, type AccessContext } from '../access.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { canWriteArea, fail, ID, isRecord, json, resolveArea } from './shared.ts';

/**
 * Räume for distribution Aktionen and the Aktion's time window.
 *
 * A Gruppe works in a Gebiet in stages. Someone opens a room for the Gebiet and says how many people take part (by hand: devices are never counted),
 * others join with a link or QR code, and when the stage is over the room is finished. The row is the record for planning the next Aktion: how long,
 * how many people, how many houses. Guests who join with the link get an access of their own (a team-editor grant bound to the room and to its Gebiet)
 * that ends with the room; where the rights are decided, nothing but the grant is trusted.
 */
export type RoomOptions = { now?: () => number };

const MODES = ['link', 'team', 'password', 'open'] as const;
type Mode = (typeof MODES)[number];
const MAX_GUESTS = 300;
const LOCK_AFTER = 8;
const LOCK_MS = 10 * 60_000;
const GUEST_SESSION_SECONDS = 16 * 60 * 60;

type RoomRow = {
  id: string; campaign_id: string; area_id: string; area_name: string; team_id: string; team_name: string; team_color: string; status: 'active' | 'finished';
  headcount: number; join_mode: Mode; join_secret: string; password_salt: string | null; password_hash: string | null; failed_joins: number; locked_until: string | null;
  started_at: string; ended_at: string | null; started_by: string; seq_start: number; houses_total: number | null; houses_done: number | null; area_done: number | null;
};

const nowOf = (options: RoomOptions) => (options.now ?? Date.now)();
const iso = (ms: number) => new Date(ms).toISOString();
const staff = (access: AccessContext) => access.role === 'admin' || (access.role === 'team-editor' && !access.roomId);
const isMember = (access: AccessContext, room: RoomRow) => access.role === 'admin' || (access.role === 'team-editor' && access.teamId === room.team_id && (!access.roomId || access.roomId === room.id));

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function passwordHash(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 60_000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Houses marked done in the Gebiet since the room opened (the write counter then). */
async function doneSince(db: D1DatabaseLike, room: RoomRow): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND seq > ? AND status = 'completed' AND key LIKE 'h:%'")
    .bind(room.campaign_id, room.area_id, room.seq_start).first<{ n: number }>();
  return row?.n ?? 0;
}
async function areaDone(db: D1DatabaseLike, room: RoomRow): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status = 'completed' AND key LIKE 'h:%'").bind(room.campaign_id, room.area_id).first<{ n: number }>();
  return row?.n ?? 0;
}

async function present(db: D1DatabaseLike, room: RoomRow, withSecret: boolean) {
  const active = room.status === 'active';
  return {
    id: room.id, areaId: room.area_id, areaName: room.area_name, teamId: room.team_id, teamName: room.team_name, teamColor: room.team_color, status: room.status,
    headcount: room.headcount, joinMode: room.join_mode, passwordSet: !!room.password_hash, startedAt: room.started_at, endedAt: room.ended_at, startedBy: room.started_by,
    housesTotal: room.houses_total, housesDone: active ? await doneSince(db, room) : room.houses_done, areaDone: active ? await areaDone(db, room) : room.area_done,
    ...(withSecret && active ? { joinSecret: room.join_secret } : {}),
  };
}

const loadRoom = (db: D1DatabaseLike, id: string) => db.prepare('SELECT * FROM v5_rooms WHERE id = ?').bind(id).first<RoomRow>();
const notFound = () => fail(404, 'not_found', 'Raum nicht gefunden.');

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'unsupported_media_type', 'JSON erwartet.');
  const text = await request.text();
  if (text.length > 10_000) return fail(413, 'too_large', 'Anfrage zu groß.');
  try { const body = JSON.parse(text); return isRecord(body) ? body : fail(400, 'invalid_json', 'JSON-Objekt erwartet.'); } catch { return fail(400, 'invalid_json', 'Ungültiges JSON.'); }
}

const intIn = (value: unknown, min: number, max: number): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null);

// ── the Aktion's time window ─────────────────────────────────────
export async function readWindow(db: D1DatabaseLike, campaignId: string): Promise<{ startsAt: string | null; endsAt: string | null } | null> {
  try {
    const row = await db.prepare('SELECT window_starts_at, window_ends_at FROM campaigns WHERE id = ?').bind(campaignId).first<{ window_starts_at: string | null; window_ends_at: string | null }>();
    return row && (row.window_starts_at || row.window_ends_at) ? { startsAt: row.window_starts_at, endsAt: row.window_ends_at } : null;
  } catch { return null; /* the window migration (0028) is not there yet: there is simply no window */ }
}

export async function putWindow(db: D1DatabaseLike, access: AccessContext, campaignId: string, request: Request): Promise<Response> {
  if (access.role !== 'admin') return fail(403, 'forbidden', 'Nur Admins legen das Zeitfenster fest.');
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parse = (value: unknown): string | null | 'bad' => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return 'bad';
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms > Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? iso(ms) : 'bad';
  };
  const startsAt = parse(body.startsAt), endsAt = parse(body.endsAt);
  if (startsAt === 'bad' || endsAt === 'bad') return fail(400, 'invalid_window', 'Datum ungültig.');
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return fail(400, 'invalid_window', 'Das Ende muss nach dem Start liegen.');
  const [result] = await db.batch([db.prepare('UPDATE campaigns SET window_starts_at = ?, window_ends_at = ? WHERE id = ?').bind(startsAt, endsAt, campaignId)]);
  if ((result?.meta?.changes ?? 0) !== 1) return fail(404, 'not_found', 'Aktion nicht gefunden.');
  return json({ window: startsAt || endsAt ? { startsAt, endsAt } : null });
}

// ── rooms of a campaign ──────────────────────────────────────────
export async function listRooms(db: D1DatabaseLike, access: AccessContext, campaignId: string, options: RoomOptions): Promise<Response> {
  if (access.role === 'collection-collector') return fail(403, 'forbidden', 'Für Helfer gibt es keine Räume.');
  const rows = (await db.prepare('SELECT * FROM v5_rooms WHERE campaign_id = ? ORDER BY started_at DESC, id DESC LIMIT 1000').bind(campaignId).all<RoomRow>()).results;
  const visible = rows.filter((room) => access.role === 'admin' || access.role === 'viewer' || (access.role === 'team-editor' && access.teamId === room.team_id && (!access.roomId || access.roomId === room.id)));
  const rooms = await Promise.all(visible.map((room) => present(db, room, isMember(access, room))));
  return json({ rooms, serverNow: nowOf(options) });
}

export async function createRoom(db: D1DatabaseLike, access: AccessContext, campaignId: string, request: Request, options: RoomOptions): Promise<Response> {
  if (!staff(access)) return fail(403, 'forbidden', 'Nur Admins und Gruppen dürfen einen Raum öffnen.');
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const headcount = intIn(body.headcount, 1, 1000);
  if (headcount === null) return fail(400, 'headcount_required', 'Bitte die Anzahl der Personen angeben (1 bis 1000).');
  const mode: Mode = typeof body.joinMode === 'string' && (MODES as readonly string[]).includes(body.joinMode) ? (body.joinMode as Mode) : 'link';
  if (body.joinMode !== undefined && mode !== body.joinMode) return fail(400, 'invalid_mode', 'Beitrittsart ungültig.');
  let password: string | null = null;
  if (mode === 'password') {
    password = typeof body.password === 'string' ? body.password : null;
    if (!password || password.length < 4 || password.length > 64) return fail(400, 'password_required', 'Das Passwort braucht 4 bis 64 Zeichen.');
  }
  const housesTotal = body.housesTotal === undefined || body.housesTotal === null ? null : intIn(body.housesTotal, 0, 10_000_000);
  if (body.housesTotal !== undefined && body.housesTotal !== null && housesTotal === null) return fail(400, 'invalid_total', 'Häuserzahl ungültig.');
  const areaId = typeof body.areaId === 'string' && ID.test(body.areaId) ? body.areaId : '';
  const area = areaId ? await resolveArea(db, campaignId, areaId) : null;
  if (!area || area.source !== 'distribution' || !(await canWriteArea(db, access, campaignId, area))) return fail(403, 'area_forbidden', 'In diesem Gebiet darfst du keinen Raum öffnen.');
  const team = await db.prepare('SELECT name, color FROM teams WHERE id = ? AND campaign_id = ?').bind(area.teamId, campaignId).first<{ name: string; color: string }>();
  if (!team) return fail(409, 'team_missing', 'Die Gruppe des Gebiets gibt es nicht mehr.');
  const counter = await db.prepare('SELECT seq FROM v5_counters WHERE campaign_id = ?').bind(campaignId).first<{ seq: number }>();
  const id = `room_${crypto.randomUUID()}`;
  const salt = password ? randomSecret().slice(0, 22) : null;
  const hash = password && salt ? await passwordHash(password, salt) : null;
  const startedAt = iso(nowOf(options));
  try {
    await db.batch([db.prepare(
      `INSERT INTO v5_rooms (id, campaign_id, area_id, area_name, team_id, team_name, team_color, status, headcount, join_mode, join_secret, password_salt, password_hash, started_at, started_by, seq_start, houses_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, campaignId, area.id, area.name.slice(0, 160), area.teamId, team.name.slice(0, 160), team.color, headcount, mode, randomSecret(), salt, hash, startedAt, (access.label ?? access.grantId).slice(0, 80), counter?.seq ?? 0, housesTotal)]);
  } catch (error) {
    if (/unique/iu.test(error instanceof Error ? error.message : String(error))) return fail(409, 'room_active', 'In diesem Gebiet läuft schon ein Raum.');
    throw error;
  }
  return json({ room: await present(db, (await loadRoom(db, id))!, true) }, { status: 201 });
}

export async function updateRoom(db: D1DatabaseLike, access: AccessContext, campaignId: string, roomId: string, request: Request): Promise<Response> {
  const room = await loadRoom(db, roomId);
  if (!room || room.campaign_id !== campaignId || !isMember(access, room)) return notFound();
  if (room.status !== 'active') return fail(409, 'room_finished', 'Der Raum ist beendet.');
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const sets: string[] = [], values: unknown[] = [];
  if (body.headcount !== undefined) {
    const headcount = intIn(body.headcount, 1, 1000);
    if (headcount === null) return fail(400, 'headcount_required', 'Bitte die Anzahl der Personen angeben (1 bis 1000).');
    sets.push('headcount = ?'); values.push(headcount);
  }
  if (body.housesTotal !== undefined && body.housesTotal !== null) {
    const total = intIn(body.housesTotal, 0, 10_000_000);
    if (total === null) return fail(400, 'invalid_total', 'Häuserzahl ungültig.');
    sets.push('houses_total = ?'); values.push(total);
  }
  if (body.joinMode !== undefined || body.password !== undefined) {
    if (!staff(access)) return fail(403, 'forbidden', 'Die Beitrittsart ändern nur Admins und die Gruppe.');
    const mode = typeof body.joinMode === 'string' && (MODES as readonly string[]).includes(body.joinMode) ? (body.joinMode as Mode) : body.joinMode === undefined ? room.join_mode : null;
    if (!mode) return fail(400, 'invalid_mode', 'Beitrittsart ungültig.');
    if (mode === 'password') {
      const password = typeof body.password === 'string' ? body.password : null;
      if (password === null && !room.password_hash) return fail(400, 'password_required', 'Das Passwort braucht 4 bis 64 Zeichen.');
      if (password !== null) {
        if (password.length < 4 || password.length > 64) return fail(400, 'password_required', 'Das Passwort braucht 4 bis 64 Zeichen.');
        const salt = randomSecret().slice(0, 22);
        sets.push('password_salt = ?', 'password_hash = ?', 'failed_joins = 0', 'locked_until = NULL'); values.push(salt, await passwordHash(password, salt));
      }
    }
    sets.push('join_mode = ?'); values.push(mode);
  }
  if (!sets.length) return fail(400, 'nothing_to_change', 'Nichts zu ändern.');
  await db.batch([db.prepare(`UPDATE v5_rooms SET ${sets.join(', ')} WHERE id = ?`).bind(...values, roomId)]);
  return json({ room: await present(db, (await loadRoom(db, roomId))!, true) });
}

/** Revoke every guest access of a room (it ends with the room). */
const endGuests = (db: D1DatabaseLike, roomId: string, at: string) => db.batch([db.prepare('UPDATE campaign_access_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE room_id = ?').bind(at, roomId)]);

export async function finishRoom(db: D1DatabaseLike, access: AccessContext, campaignId: string, roomId: string, request: Request, options: RoomOptions): Promise<Response> {
  const room = await loadRoom(db, roomId);
  if (!room || room.campaign_id !== campaignId || !isMember(access, room) || !staff(access)) return notFound();
  if (room.status !== 'active') return fail(409, 'room_finished', 'Der Raum ist schon beendet.');
  const body = (request.headers.get('content-type') ?? '').includes('application/json') ? await readJson(request) : {};
  if (body instanceof Response) return body;
  const total = body.housesTotal === undefined || body.housesTotal === null ? room.houses_total : intIn(body.housesTotal, 0, 10_000_000);
  if (body.housesTotal !== undefined && body.housesTotal !== null && total === null) return fail(400, 'invalid_total', 'Häuserzahl ungültig.');
  const endedAt = iso(nowOf(options));
  const done = await doneSince(db, room), whole = await areaDone(db, room);
  await db.batch([db.prepare("UPDATE v5_rooms SET status = 'finished', ended_at = ?, houses_done = ?, area_done = ?, houses_total = ? WHERE id = ? AND status = 'active'").bind(endedAt, done, whole, total, roomId)]);
  await endGuests(db, roomId, endedAt);
  return json({ room: await present(db, (await loadRoom(db, roomId))!, false) });
}

export async function deleteRoom(db: D1DatabaseLike, access: AccessContext, campaignId: string, roomId: string, options: RoomOptions): Promise<Response> {
  if (access.role !== 'admin') return fail(403, 'forbidden', 'Nur Admins löschen Räume.');
  const room = await loadRoom(db, roomId);
  if (!room || room.campaign_id !== campaignId) return notFound();
  await endGuests(db, roomId, iso(nowOf(options)));
  await db.batch([db.prepare('DELETE FROM v5_rooms WHERE id = ?').bind(roomId)]);
  return json({ ok: true });
}

// ── joining (public: the person may have no access yet) ──────────
/** What the join page may know: nothing unless the link is good. The room id itself is unguessable; the secret is a second factor in `link` mode. */
function mayJoin(room: RoomRow, secret: string | null): { ok: boolean; reason?: string } {
  if (room.status !== 'active') return { ok: false, reason: 'finished' };
  if (room.join_mode === 'team') return { ok: false, reason: 'team_only' };
  if (room.join_mode === 'link' && !(secret && safeEqual(secret, room.join_secret))) return { ok: false, reason: 'bad_link' };
  return { ok: true };
}

export async function roomInfo(db: D1DatabaseLike, roomId: string, url: URL): Promise<Response> {
  const room = ID.test(roomId) ? await loadRoom(db, roomId) : null;
  if (!room) return notFound();
  const verdict = mayJoin(room, url.searchParams.get('j'));
  if (verdict.reason === 'bad_link') return notFound(); // a wrong link reveals nothing, not even that the room exists
  const campaign = await db.prepare('SELECT name FROM campaigns WHERE id = ?').bind(room.campaign_id).first<{ name: string }>();
  return json({ status: room.status, areaName: room.area_name, campaignName: campaign?.name ?? '', joinMode: room.join_mode, passwordRequired: room.join_mode === 'password', canJoin: verdict.ok, reason: verdict.reason ?? null, campaignId: verdict.ok ? room.campaign_id : null });
}

export async function joinRoom(db: D1DatabaseLike, roomId: string, request: Request, options: RoomOptions): Promise<Response> {
  const room = ID.test(roomId) ? await loadRoom(db, roomId) : null;
  if (!room) return notFound();
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const now = nowOf(options);
  const secret = typeof body.j === 'string' ? body.j : null;
  const verdict = mayJoin(room, secret);
  if (verdict.reason === 'bad_link') return notFound();
  if (!verdict.ok) return fail(403, verdict.reason === 'finished' ? 'room_finished' : 'team_only', verdict.reason === 'finished' ? 'Der Raum ist beendet.' : 'In diesen Raum kommen nur Mitglieder der Gruppe.');
  // somebody who is signed in already: an admin or a member of the Gruppe needs no join; a guest of this very room just goes on
  const current = await resolveAccess(db, request, room.campaign_id, { allowRoom: true });
  if (current?.role === 'admin') return fail(409, 'already_signed_in', 'Du bist als Admin angemeldet und siehst den Raum ohnehin.');
  if (current?.role === 'team-editor' && !current.roomId && current.teamId === room.team_id) return fail(409, 'already_member', 'Du gehörst zu dieser Gruppe und bist schon drin.');
  if (current?.roomId === room.id) return json({ campaignId: room.campaign_id, areaId: room.area_id, again: true });
  if (room.join_mode === 'password') {
    if (room.locked_until && Date.parse(room.locked_until) > now) return fail(429, 'room_locked', 'Zu viele Versuche. Bitte in ein paar Minuten noch einmal.');
    const password = typeof body.password === 'string' ? body.password : '';
    const good = !!room.password_salt && !!room.password_hash && password.length >= 1 && password.length <= 64 && safeEqual(await passwordHash(password, room.password_salt), room.password_hash);
    if (!good) {
      const failed = (room.locked_until && Date.parse(room.locked_until) <= now ? 0 : room.failed_joins) + 1;
      await db.batch([db.prepare('UPDATE v5_rooms SET failed_joins = ?, locked_until = ? WHERE id = ?').bind(failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? iso(now + LOCK_MS) : null, room.id)]);
      return fail(403, 'wrong_password', 'Das Passwort stimmt nicht.');
    }
    await db.batch([db.prepare('UPDATE v5_rooms SET failed_joins = 0, locked_until = NULL WHERE id = ?').bind(room.id)]);
  }
  const guests = await db.prepare('SELECT COUNT(*) AS n FROM v5_room_guests WHERE room_id = ?').bind(room.id).first<{ n: number }>();
  if ((guests?.n ?? 0) >= MAX_GUESTS) return fail(429, 'room_full', 'In diesem Raum sind zu viele Gäste.');
  const label = (typeof body.label === 'string' ? body.label : '').replace(/[\u0000-\u001f\u007f<>]/gu, '').trim().slice(0, 40) || 'Gast';
  const grantId = `grant_${crypto.randomUUID()}`;
  const at = iso(now);
  await db.batch([
    db.prepare('INSERT INTO campaign_access_grants (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .bind(grantId, room.campaign_id, 'team-editor', room.team_id, await hashSecret(randomSecret()), label, at, room.id),
    db.prepare('INSERT INTO v5_room_guests (room_id, grant_id, label, joined_at) VALUES (?, ?, ?, ?)').bind(room.id, grantId, label, at),
  ]);
  const session = await createSessionForGrant(db, { grantId, campaignId: room.campaign_id, role: 'team-editor', teamId: room.team_id, label }, { ttlSeconds: GUEST_SESSION_SECONDS });
  return json({ campaignId: room.campaign_id, areaId: room.area_id }, { headers: { 'set-cookie': sessionCookie(session.sessionSecret, GUEST_SESSION_SECONDS) } });
}
