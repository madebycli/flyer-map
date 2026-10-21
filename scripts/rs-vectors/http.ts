/**
 * Contract vectors for `flyermap-worker`: real requests answered by the TypeScript Worker (the oracle) on a seeded SQLite database.
 * Writes the database as it was before the first request (`v5.seed.sql`) and every exchange in order (`v5.json`). The Rust Worker replays them
 * against a copy of the same database and must answer with the same status, the same JSON and the same headers that matter.
 *   node --experimental-transform-types scripts/rs-vectors/http.ts
 * Ids and secrets are random, so a new run writes a new pair of files; always commit both together.
 */
import { writeFileSync } from 'node:fs';
import { setup, campaign, NOW, stamp } from '../../tests/helpers/v5Setup.ts';
import { handleV5Api } from '../../worker/v5/api.ts';

const DIR = new URL('../../flyermap-rs/crates/flyermap-worker/tests/vectors/', import.meta.url);
const { db, cookies } = await setup();
// Sessions are made with the real clock; the requests run at the fixed NOW. Far-future expiry keeps the pair valid whatever clock replays it.
db.sqlite.exec("UPDATE campaign_sessions SET expires_at = '2099-01-01T00:00:00.000Z'");
const base = `/api/v5/campaigns/${campaign}`;
// Map data for the overview (pack versions the sizes must match) and the leftovers of a deleted Gebiet for "forget".
const run = (sql: string, ...args: unknown[]) => db.sqlite.prepare(sql).run(...args);
const T = '2026-09-07T00:00:00.000Z';
for (const [area, version] of [['area_n', 3], ['area_o', 1], ['area_gone', 2], ['area_gone~1', 2], ['area_goner', 1]] as const) {
  run('INSERT INTO v5_pack_meta (campaign_id, area_id, version, chunks, total_bytes, engine, stats_json, built_at) VALUES (?, ?, ?, 1, 4, ?, ?, ?)', campaign, area, version, 'e1', '{}', T);
  run('INSERT INTO v5_packs (campaign_id, area_id, version, chunk, bytes) VALUES (?, ?, ?, 0, ?)', campaign, area, version, Buffer.from('pack'));
}
run('INSERT INTO v5_pack_attempts (campaign_id, area_id, at) VALUES (?, ?, 1)', campaign, 'area_gone');
for (const [table, counters] of [['v5_state', 'v5_counters'], ['v5_notes', 'v5_note_counters']]) run(`INSERT OR IGNORE INTO ${counters} (campaign_id, seq) VALUES (?, 0)`, campaign);
let seq = (db.sqlite.prepare('SELECT seq FROM v5_counters WHERE campaign_id = ?').get(campaign) as { seq: number }).seq;
for (const [key, status, wall] of [['h:gone1', 'completed', 10_000], ['h:gone2', 'later', 9000], ['s:gone#1', 'completed', 8000], ['h:gone3', 'open', 7000]] as const) {
  run('INSERT INTO v5_state (campaign_id, key, op_id, status, area_id, actor, grant_id, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', campaign, key, stamp(NOW - wall), status, 'area_gone', 'x', 'grant_x', ++seq);
}
run('UPDATE v5_counters SET seq = ? WHERE campaign_id = ?', seq, campaign);
let noteSeq = (db.sqlite.prepare('SELECT seq FROM v5_note_counters WHERE campaign_id = ?').get(campaign) as { seq: number }).seq;
for (const [id, deleted] of [['note_gone1', 0], ['note_gone2', 1]] as const) {
  run('INSERT INTO v5_notes (campaign_id, id, key, area_id, flag, body, rev, deleted, actor, grant_id, seq) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)', campaign, id, 'h:gone1', 'area_gone', 'alt', stamp(NOW - 5000), deleted, 'x', 'grant_x', ++noteSeq);
}
run('UPDATE v5_note_counters SET seq = ? WHERE campaign_id = ?', noteSeq, campaign);

// The database before the first request, as SQL text (schema in creation order, then the rows): small, readable, diffable.
function dump(): string {
  const lines: string[] = ['PRAGMA foreign_keys=OFF;'];
  const objects = db.sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as { type: string; name: string; sql: string }[];
  for (const o of objects) lines.push(`${o.sql};`);
  const quote = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `X'${Buffer.from(v).toString('hex')}'` : `'${String(v).replaceAll("'", "''")}'`);
  for (const o of objects.filter((x) => x.type === 'table')) {
    for (const row of db.sqlite.prepare(`SELECT * FROM "${o.name}"`).all() as Record<string, unknown>[]) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => quote(row[c])).join(', ')});`);
    }
  }
  lines.push('PRAGMA foreign_keys=ON;');
  return `${lines.join('\n')}\n`;
}
const seedSql = dump();

type Exchange = { who: string | null; method: string; path: string; headers: Record<string, string>; body: string | null; status: number; response: unknown; contentType: string | null; cacheControl: string | null; setCookie: string | null };
const exchanges: Exchange[] = [];
async function call(who: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { ...(who ? { cookie: cookies[who] } : {}), ...(text !== null ? { 'content-type': 'application/json' } : {}), ...extra };
  const res = (await handleV5Api(new Request(`https://example.test${path}`, { method, headers, body: text ?? undefined }), db, { now: () => NOW }))!;
  const raw = await res.text();
  let response: unknown = raw;
  try { response = JSON.parse(raw); } catch { /* not JSON */ }
  exchanges.push({ who, method, path, headers, body: text, status: res.status, response, contentType: res.headers.get('content-type'), cacheControl: res.headers.get('cache-control'), setCookie: res.headers.get('set-cookie') });
  return response as Record<string, any>;
}
const op = (id: string, key: string, status: string, area = 'area_n') => ({ id, key, status, area });

// who may come in at all
await call(null, 'GET', `${base}/state?since=0`);
await call('admin', 'GET', '/api/v5/nonsense');
await call('admin', 'PUT', `${base}/state`);
await call('admin', 'GET', '/api/v5/basemap');
// boot data per role
for (const who of ['admin', 'viewer', 'editor', 'other']) await call(who, 'GET', `${base}/meta`);
// edits: accepted, idempotent, last writer wins
await call('admin', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 5000), 'h:a', 'completed'), op(stamp(NOW - 4000), 'h:b', 'later'), op(stamp(NOW - 3000), 's:x#1', 'completed')] });
await call('admin', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 5000), 'h:a', 'completed')] });
await call('admin', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 9000), 'h:a', 'open'), op(stamp(NOW - 2000), 'h:b', 'not-deliverable'), op(stamp(NOW - 2500), 'h:b', 'completed')] });
// reading back, whole and in pages
await call('viewer', 'GET', `${base}/state?since=0`);
await call('viewer', 'GET', `${base}/state?since=0&limit=2`);
await call('viewer', 'GET', `${base}/state?since=2&limit=2`);
await call('viewer', 'GET', `${base}/state?since=abc&limit=-4`);
// scope
await call('viewer', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 1000), 'h:v', 'completed')] });
await call('editor', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 1000), 'h:e1', 'completed', 'area_o'), op(stamp(NOW - 999), 'h:e2', 'completed', 'area_n')] });
await call('other', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 900), 'h:a', 'later', 'area_o'), op(stamp(NOW - 899), 'h:o1', 'completed', 'area_o')] });
await call('editor', 'GET', `${base}/state?since=0`);
await call('other', 'GET', `${base}/state?since=0`);
// every way a request can be wrong
await call('admin', 'POST', `${base}/ops`, '{"ops":[]}', { 'content-type': 'text/plain' });
await call('admin', 'POST', `${base}/ops`, '{"ops":[');
await call('admin', 'POST', `${base}/ops`, '[]');
await call('admin', 'POST', `${base}/ops`, { ops: [] });
await call('admin', 'POST', `${base}/ops`, { ops: Array.from({ length: 201 }, (_, i) => op(stamp(NOW - 100_000 + i), `h:m${i}`, 'later')) });
await call('admin', 'POST', `${base}/ops`, `{"ops":[${'1,'.repeat(60_000)}1]}`);
await call('admin', 'POST', `${base}/ops`, { ops: [7, op('junk', 'h:a', 'completed'), op(stamp(NOW + 2 * 86_400_000), 'h:a', 'completed'), op(stamp(NOW - 10), 'x:a', 'completed'), op(stamp(NOW - 10), 'h:a', 'done'), op(stamp(NOW - 10), 'h:a', 'completed', 'bad area'), { id: stamp(NOW - 10), key: 'h:a', status: 'completed' }, op(stamp(NOW - 10), 'h:a', 'completed', 'area_unknown')] });
await call('admin', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 10), 'h:z', 'completed')] }, { origin: 'https://evil.test' });
await call('admin', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 10), 'h:z', 'completed')] }, { origin: 'https://example.test' });
await call('admin', 'GET', `${base}/state?since=0`);
// notes: written, read back, refused for every reason
const note = (id: string, key: string, area: string, extra: Record<string, unknown> = {}) => ({ id, rev: id, key, area, flag: null, text: 'Hinweis', ...extra });
await call('admin', 'POST', `${base}/notes`, { notes: [note(stamp(NOW - 900), 'h:a', 'area_n'), note(stamp(NOW - 899), 'a:area_n', 'area_n', { flag: 'dog', text: '' }), note(stamp(NOW - 898), 's:x#1', 'area_n', { text: '  Tor zu \u0007 ' })] });
await call('admin', 'POST', `${base}/notes`, { notes: [{ ...note(stamp(NOW - 900), 'h:a', 'area_n'), rev: stamp(NOW - 800), text: 'geändert' }, { ...note(stamp(NOW - 900), 'h:a', 'area_n'), rev: stamp(NOW - 850), text: 'älter' }] });
await call('viewer', 'POST', `${base}/notes`, { notes: [note(stamp(NOW - 700), 'h:a', 'area_n')] });
await call('other', 'POST', `${base}/notes`, { notes: [note(stamp(NOW - 690), 'h:a', 'area_o'), note(stamp(NOW - 689), 'h:new', 'area_o'), note(stamp(NOW - 688), 'h:new2', 'area_n')] });
await call('admin', 'POST', `${base}/notes`, { notes: [{ ...note(stamp(NOW - 900), 'h:b', 'area_n'), rev: stamp(NOW - 600) }] });
await call('admin', 'POST', `${base}/notes`, { notes: [5, { ...note(stamp(NOW - 500), 'h:a', 'area_n'), rev: stamp(NOW - 501) }, note(stamp(NOW + 2 * 86_400_000), 'h:a', 'area_n'), note(stamp(NOW - 499), 'x:a', 'area_n'), note(stamp(NOW - 498), 'h:a', 'bad area'), note(stamp(NOW - 497), 'a:area_o', 'area_n'), note(stamp(NOW - 496), 'h:a', 'area_n', { flag: 'cat' }), note(stamp(NOW - 495), 'h:a', 'area_n', { text: 5 }), note(stamp(NOW - 494), 'h:a', 'area_n', { text: ' ' }), note(stamp(NOW - 493), 'h:a', 'area_n', { text: '', deleted: true })] });
await call('admin', 'POST', `${base}/notes`, { notes: [] });
await call('admin', 'POST', `${base}/notes`, '{"notes":', {});
for (const who of ['viewer', 'editor', 'other']) await call(who, 'GET', `${base}/notes?since=0`);
await call('viewer', 'GET', `${base}/notes?since=1&limit=2`);
await call('admin', 'GET', `/api/v5/campaigns/${encodeURIComponent('bad id!')}/state`);
await call('admin', 'GET', `/api/v5/campaigns/campaign_missing/meta`);
// the Aktion's time window
const win = `${base}/window`;
await call('viewer', 'PUT', win, { startsAt: '2030-01-01T10:00:00Z' });
await call('admin', 'PUT', win, { startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T09:00:00Z' });
await call('admin', 'PUT', win, { startsAt: 'nope' });
await call('admin', 'PUT', win, { startsAt: '1999-12-31T00:00:00Z' });
await call('admin', 'PUT', win, { startsAt: '2030-01-01T08:00:00+02:00', endsAt: '2030-01-01T18:30:00Z' });
await call('editor', 'GET', `${base}/meta`);
await call('admin', 'PUT', win, { startsAt: null, endsAt: '' });
// rooms: opening, every refusal, joining by link and by password, the lock, guests, finishing, deleting
const rooms = `${base}/rooms`;
await call('viewer', 'POST', rooms, { headcount: 3, areaId: 'area_n' });
await call('editor', 'POST', rooms, { areaId: 'area_n' });
await call('editor', 'POST', rooms, { headcount: 3, areaId: 'area_o' });
await call('editor', 'POST', rooms, { headcount: 3, areaId: 'area_n', joinMode: 'bad' });
await call('editor', 'POST', rooms, { headcount: 3, areaId: 'area_n', joinMode: 'password', password: 'ab' });
await call('editor', 'POST', rooms, { headcount: 3, areaId: 'area_n', housesTotal: -1 });
const linkRoom = (await call('editor', 'POST', rooms, { headcount: 3, areaId: 'area_n', housesTotal: 120 })).room;
await call('editor', 'POST', rooms, { headcount: 2, areaId: 'area_n' });
const passRoom = (await call('admin', 'POST', rooms, { headcount: 2, areaId: 'area_o', joinMode: 'password', password: 'geheim1' })).room;
await call('editor', 'GET', rooms);
await call('other', 'GET', rooms);
const pub = (id: string) => `/api/v5/rooms/${id}`;
await call(null, 'GET', pub(linkRoom.id));
await call(null, 'GET', `${pub(linkRoom.id)}?j=wrong`);
await call(null, 'GET', `${pub(linkRoom.id)}?j=${linkRoom.joinSecret}`);
await call(null, 'GET', pub(passRoom.id));
await call(null, 'GET', pub('room_nope'));
await call(null, 'PUT', pub(linkRoom.id));
await call(null, 'POST', `${pub(linkRoom.id)}/join`, { label: 'Anna' });
await call(null, 'POST', `${pub(linkRoom.id)}/join`, { j: linkRoom.joinSecret }, { origin: 'https://evil.test' });
await call('editor', 'POST', `${pub(linkRoom.id)}/join`, { j: linkRoom.joinSecret });
await call('admin', 'POST', `${pub(linkRoom.id)}/join`, { j: linkRoom.joinSecret });
const joined = async (who: string, roomId: string, body: Record<string, unknown>) => {
  await call(null, 'POST', `${pub(roomId)}/join`, body);
  cookies[who] = exchanges.at(-1)!.setCookie!.split(';')[0];
};
await joined('guestA', linkRoom.id, { j: linkRoom.joinSecret, label: '  <b>Anna</b>\u0007 ' });
await call('guestA', 'POST', `${pub(linkRoom.id)}/join`, { j: linkRoom.joinSecret });
for (let i = 0; i < 9; i++) await call(null, 'POST', `${pub(passRoom.id)}/join`, { password: `falsch${i}` });
await call(null, 'POST', `${pub(passRoom.id)}/join`, { password: 'geheim1' });
await call('admin', 'PATCH', `${rooms}/${passRoom.id}`, { password: 'neuespw1' });
await joined('guestB', passRoom.id, { password: 'neuespw1' });
await call('guestA', 'GET', rooms);
await call('guestA', 'GET', `${base}/meta`);
await call('guestA', 'POST', `${base}/ops`, { ops: [op(stamp(NOW - 300), 'h:g1', 'completed', 'area_n'), op(stamp(NOW - 299), 'h:g2', 'completed', 'area_o')] });
await call('guestA', 'PATCH', `${rooms}/${linkRoom.id}`, { headcount: 5 });
await call('guestA', 'PATCH', `${rooms}/${linkRoom.id}`, { joinMode: 'open' });
await call('guestA', 'PATCH', `${rooms}/${passRoom.id}`, { headcount: 5 });
await call('editor', 'PATCH', `${rooms}/${linkRoom.id}`, {});
await call('editor', 'PATCH', `${rooms}/${linkRoom.id}`, { housesTotal: -1 });
await call('editor', 'PATCH', `${rooms}/${linkRoom.id}`, { joinMode: 'password' });
await call('editor', 'PATCH', `${rooms}/${linkRoom.id}`, { joinMode: 'team', headcount: 4, housesTotal: 0 });
await call('editor', 'GET', rooms);
await call('guestA', 'POST', `${rooms}/${linkRoom.id}/finish`);
await call('editor', 'GET', `${rooms}/${linkRoom.id}/finish`);
await call('editor', 'POST', `${rooms}/${linkRoom.id}/finish`, { housesTotal: 'viele' });
await call('editor', 'POST', `${rooms}/${linkRoom.id}/finish`, { housesTotal: 130 });
await call('editor', 'POST', `${rooms}/${linkRoom.id}/finish`);
await call('guestA', 'GET', rooms);
await call(null, 'GET', `${pub(linkRoom.id)}?j=${linkRoom.joinSecret}`);
await call(null, 'POST', `${pub(linkRoom.id)}/join`, { j: linkRoom.joinSecret });
await call('editor', 'PATCH', `${rooms}/${linkRoom.id}`, { headcount: 9 });
await call('other', 'DELETE', `${rooms}/${passRoom.id}`);
await call('admin', 'DELETE', `${rooms}/${passRoom.id}`);
await call('admin', 'DELETE', `${rooms}/${passRoom.id}`);
await call('guestB', 'GET', rooms);
await call('admin', 'GET', rooms);
// the overview: sizes reported by devices, done counts per readable Gebiet, the short cache
const stats = `${base}/areas/stats`;
const unit = (u: string, area: string, packVersion: number, houses: number, segments: number) => ({ unit: u, area, packVersion, houses, segments });
await call('admin', 'GET', `${base}/progress`);
await call('viewer', 'PUT', stats, { units: [unit('area_n', 'area_n', 3, 10, 5)] });
await call('admin', 'PUT', stats, '{"units":[]}', { 'content-type': 'text/plain' });
await call('admin', 'PUT', stats, '{"units":');
await call('admin', 'PUT', stats, []);
await call('admin', 'PUT', stats, { units: [] });
await call('admin', 'PUT', stats, { units: [unit('area_o~1', 'area_n', 3, 1, 1)] });
await call('admin', 'PUT', stats, { units: [unit('area_n~12345', 'area_n', 3, 1, 1)] });
await call('admin', 'PUT', stats, { units: [unit('area_n', 'area_n', 3, -1, 1)] });
await call('admin', 'PUT', stats, { units: [unit('area_n', 'area_n', 3.5, 1, 1)] });
await call('admin', 'PUT', stats, { units: [unit('area_x', 'area_x', 1, 1, 1)] });
await call('admin', 'PUT', stats, { units: [unit('area_n~1', 'area_n', 3, 120, 40), unit('area_n~2', 'area_n', 3, 80, 21), unit('area_o', 'area_o', 0, 50, 9)] });
await call('admin', 'PUT', stats, { units: [unit('area_n~2', 'area_n', 3, 81, 22)] });
for (const who of ['admin', 'viewer', 'editor', 'other']) await call(who, 'GET', `${base}/progress`);
await call('admin', 'POST', `${base}/ops`, { ops: Array.from({ length: 30 }, (_, i) => op(stamp(NOW - 200 + i), `h:p${i}`, i % 3 ? 'completed' : 'later')) });
await call('admin', 'GET', `${base}/progress`);
await call('admin', 'PUT', stats, { units: [unit('area_o', 'area_o', 1, 50, 9)] });
await call('admin', 'GET', `${base}/progress`);
await call('admin', 'POST', `${base}/progress`);
// clean-up: prune keys of a reshaped Gebiet, forget a deleted one; both leave tombstones
const prune = `${base}/areas/area_n/prune`;
const many = Array.from({ length: 25 }, (_, i) => `h:p${i}`);
await call('viewer', 'POST', prune, { keys: ['h:a'] });
await call('admin', 'POST', `${base}/areas/area_x/prune`, { keys: ['h:a'] });
await call('admin', 'POST', prune, '{"keys":["h:a"]}', { 'content-type': 'text/plain' });
await call('admin', 'POST', prune, '{"keys":');
await call('admin', 'POST', prune, ['h:a']);
await call('admin', 'POST', prune, { keys: [] });
await call('admin', 'POST', prune, { keys: ['x:a'] });
await call('admin', 'POST', prune, { keys: ['h:nothing', 'h:e1'] });
await call('admin', 'POST', prune, { keys: many });
await call('admin', 'POST', prune, { keys: [...many, 'h:p0'], confirm: true });
await call('admin', 'POST', prune, { keys: ['h:a', 'h:b', 'h:a', 's:x#1', 'h:p29'] });
await call('admin', 'GET', prune);
await call('viewer', 'GET', `${base}/state?since=0`);
await call('viewer', 'POST', `${base}/areas/area_gone/forget`);
await call('admin', 'POST', `${base}/areas/area_n/forget`);
await call('admin', 'POST', `${base}/areas/area_gone/forget`);
await call('admin', 'POST', `${base}/areas/area_gone/forget`);
await call('admin', 'GET', `${base}/state?since=0`);
await call('admin', 'GET', `${base}/notes?since=0`);
await call('admin', 'GET', `${base}/meta`);

const seedFile = new URL('v5.seed.sql', DIR);
const text = `${JSON.stringify({ about: 'made by scripts/rs-vectors/http.ts from the TypeScript Worker; do not edit', now: NOW, cookies, exchanges }, null, 1)}\n`;
const file = new URL('v5.json', DIR);
writeFileSync(file, text);
writeFileSync(seedFile, seedSql);
console.log(`wrote ${exchanges.length} exchanges`);
