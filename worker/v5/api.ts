import { decodeClock } from '../../src/v5/store/hlc.ts';
import { isStatus } from '../../src/v5/store/types.ts';
import { ENGINE_VERSION, encodePack, overpassQuery, packFromOverpass, paddedBbox } from '../../src/v5/engine/index.ts';
import type { AccessContext } from '../access.ts';
import { resolveAccess } from '../access.ts';
import { loadCanonicalArea, type D1DatabaseLike } from '../campaignRepository.ts';
import { parseCampaignId } from '../snapshotValidation.ts';

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { ...init, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...init.headers } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, { status });

export type V5Options = {
  fetchImpl?: typeof fetch;
  overpassUrl?: string;
  now?: () => number;
  maxPackBytes?: number;
};

const MAX_OPS = 200;
const ROWS_PER_STATEMENT = 10; // 9 bound parameters per row; D1 allows 100 per statement.
const PACK_CHUNK_BYTES = 512 * 1024;
const MAX_AREA_SQ_KM = 25;
const PACK_REBUILD_COOLDOWN_MS = 60_000;
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const KEY = /^[sh]:[A-Za-z0-9#:._-]{1,80}$/u;
const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

type Route =
  | { kind: 'state' | 'ops' | 'meta'; campaignId: string }
  | { kind: 'pack'; campaignId: string; areaId: string };

export function v5Route(pathname: string): Route | null {
  const m = /^\/api\/v5\/campaigns\/([^/]+)\/(state|ops|meta|areas\/([^/]+)\/pack)$/u.exec(pathname);
  if (!m) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(m[1]));
    if (!campaignId) return null;
    if (m[2] === 'state' || m[2] === 'ops' || m[2] === 'meta') return { kind: m[2], campaignId };
    const areaId = decodeURIComponent(m[3]);
    return ID.test(areaId) ? { kind: 'pack', campaignId, areaId } : null;
  } catch { return null; }
}

const writesAllowed = (a: AccessContext) => a.role === 'admin' || a.role === 'team-editor' || a.role === 'field-group-member';
const isScoped = (a: AccessContext) => a.role === 'team-editor' || a.role === 'field-group-member';

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function handleV5Api(request: Request, db: D1DatabaseLike, options: V5Options = {}): Promise<Response | null> {
  const url = new URL(request.url);
  const route = v5Route(url.pathname);
  if (!route) return url.pathname.startsWith('/api/v5/') ? fail(404, 'not_found', 'Unbekannte v5-Route.') : null;
  const access = await resolveAccess(db, request, route.campaignId);
  if (!access) return fail(401, 'unauthorized', 'Kein Zugriff auf diese Aktion.');
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) return fail(403, 'cross_origin', 'Anfrage von fremdem Ursprung.');
  if (route.kind === 'meta' && request.method === 'GET') return meta(db, access, route.campaignId);
  if (route.kind === 'state' && request.method === 'GET') return pullState(db, access, route.campaignId, url);
  if (route.kind === 'ops' && request.method === 'POST') return pushOps(db, access, route.campaignId, request, options);
  if (route.kind === 'pack' && request.method === 'GET') return getPack(db, access, route.campaignId, route.areaId, request);
  if (route.kind === 'pack' && request.method === 'POST') return buildPack(db, access, route.campaignId, route.areaId, options);
  return fail(405, 'method_not_allowed', 'Methode nicht erlaubt.');
}

async function canSeeArea(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string) {
  const area = await loadCanonicalArea(db, campaignId, areaId);
  if (!area) return null;
  if (!isScoped(access)) return area;
  return access.teamId === area.teamId ? area : null;
}

/** Everything the field client needs to boot, in one small request: role, team colours, Areas and pack versions. */
async function meta(db: D1DatabaseLike, access: AccessContext, campaignId: string): Promise<Response> {
  const campaign = await db.prepare('SELECT id, name FROM campaigns WHERE id = ?').bind(campaignId).first<{ id: string; name: string }>();
  if (!campaign) return fail(404, 'not_found', 'Aktion nicht gefunden.');
  const scoped = isScoped(access);
  const areas = (await db.prepare(
    `SELECT a.id, a.name, a.team_id, a.geometry_json, p.version AS pack_version, p.geometry_hash AS pack_hash FROM areas a
     LEFT JOIN v5_pack_meta p ON p.campaign_id = a.campaign_id AND p.area_id = a.id
     WHERE a.campaign_id = ?${scoped ? ' AND a.team_id = ?' : ''} ORDER BY a.created_at, a.id`,
  ).bind(...(scoped ? [campaignId, access.teamId] : [campaignId])).all<{ id: string; name: string; team_id: string; geometry_json: string; pack_version: number | null; pack_hash: string | null }>()).results;
  const teams = (await db.prepare('SELECT id, name, color FROM teams WHERE campaign_id = ? ORDER BY name, id').bind(campaignId).all<{ id: string; name: string; color: string }>()).results;
  return json({
    campaign, role: access.role, teamId: access.teamId, canWrite: writesAllowed(access),
    canBuildPack: access.role === 'admin' || access.role === 'team-editor',
    teams: scoped ? teams.filter((t) => t.id === access.teamId) : teams,
    areas: await Promise.all(areas.map(async (a) => {
      const geometry = JSON.parse(a.geometry_json);
      // A pack built for a different polygon is stale: report it as missing so the client offers a rebuild.
      const stale = a.pack_version !== null && a.pack_hash !== (await geometryHash(geometry));
      return { id: a.id, name: a.name, teamId: a.team_id, geometry, packVersion: stale ? null : a.pack_version, packStale: stale };
    })),
  });
}

async function pullState(db: D1DatabaseLike, access: AccessContext, campaignId: string, url: URL): Promise<Response> {
  const since = Math.max(0, Math.trunc(Number(url.searchParams.get('since') ?? '0')) || 0);
  const limit = Math.min(1000, Math.max(1, Math.trunc(Number(url.searchParams.get('limit') ?? '1000')) || 1000));
  const scoped = isScoped(access);
  const sql = `SELECT key, op_id, status, area_id, actor, seq FROM v5_state WHERE campaign_id = ? AND seq > ?${
    scoped ? ' AND area_id IN (SELECT id FROM areas WHERE campaign_id = ? AND team_id = ?)' : ''
  } ORDER BY seq ASC LIMIT ?`;
  const params = scoped ? [campaignId, since, campaignId, access.teamId, limit + 1] : [campaignId, since, limit + 1];
  const rows = (await db.prepare(sql).bind(...params).all<{ key: string; op_id: string; status: string; area_id: string; actor: string; seq: number }>()).results;
  const page = rows.slice(0, limit);
  return json({
    ops: page.map((row) => ({ id: row.op_id, key: row.key, status: row.status, by: row.actor, area: row.area_id })),
    cursor: page.length ? page[page.length - 1].seq : since,
    more: rows.length > limit,
  });
}

type IncomingOp = { id?: unknown; key?: unknown; status?: unknown; area?: unknown };

async function pushOps(db: D1DatabaseLike, access: AccessContext, campaignId: string, request: Request, options: V5Options): Promise<Response> {
  if (!writesAllowed(access)) return fail(403, 'read_only', 'Diese Rolle darf nichts markieren.');
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'unsupported_media_type', 'JSON erwartet.');
  const text = await request.text();
  if (text.length > 100_000) return fail(413, 'too_large', 'Zu viele Änderungen auf einmal.');
  let body: { ops?: IncomingOp[] };
  try { body = JSON.parse(text); } catch { return fail(400, 'invalid_json', 'Ungültiges JSON.'); }
  if (!Array.isArray(body.ops) || body.ops.length === 0 || body.ops.length > MAX_OPS) return fail(400, 'invalid_ops', `1 bis ${MAX_OPS} Änderungen erwartet.`);

  const now = (options.now ?? Date.now)();
  const areaOk = new Map<string, boolean>();
  const accepted: string[] = [], rejected: { id: string; reason: string }[] = [];
  const latest = new Map<string, { id: string; key: string; status: string; area: string }>();
  for (const op of body.ops) {
    const id = typeof op.id === 'string' ? op.id : '';
    const reject = (reason: string) => rejected.push({ id, reason });
    if (!decodeClock(id)) { reject('bad_id'); continue; }
    if ((decodeClock(id)?.wall ?? 0) > now + FUTURE_SKEW_MS) { reject('clock_future'); continue; }
    if (typeof op.key !== 'string' || !KEY.test(op.key)) { reject('bad_key'); continue; }
    if (!isStatus(op.status)) { reject('bad_status'); continue; }
    if (typeof op.area !== 'string' || !ID.test(op.area)) { reject('bad_area'); continue; }
    if (!areaOk.has(op.area)) areaOk.set(op.area, (await canSeeArea(db, access, campaignId, op.area)) !== null);
    if (!areaOk.get(op.area)) { reject('area_forbidden'); continue; }
    accepted.push(id);
    const prior = latest.get(op.key);
    if (!prior || prior.id < id) latest.set(op.key, { id, key: op.key, status: op.status, area: op.area });
  }
  if (latest.size && isScoped(access)) {
    // A scoped editor may only write keys that are new or already belong to the Area they claim; otherwise
    // claiming one of their own Areas would let them overwrite another team's progress.
    const keys = [...latest.keys()];
    const owner = new Map<string, string>();
    for (let i = 0; i < keys.length; i += 90) {
      const chunk = keys.slice(i, i + 90);
      const found = (await db.prepare(`SELECT key, area_id FROM v5_state WHERE campaign_id = ? AND key IN (${chunk.map(() => '?').join(',')})`).bind(campaignId, ...chunk).all<{ key: string; area_id: string }>()).results;
      for (const row of found) owner.set(row.key, row.area_id);
    }
    for (const [key, row] of [...latest]) {
      const current = owner.get(key);
      if (current !== undefined && current !== row.area) {
        latest.delete(key);
        const index = accepted.indexOf(row.id);
        if (index >= 0) accepted.splice(index, 1);
        rejected.push({ id: row.id, reason: 'key_owned_elsewhere' });
      }
    }
  }
  if (latest.size) {
    // Sequence numbers are allocated inside the same atomic batch as the upserts. Reserving them in a
    // separate request step would let a slower writer commit lower numbers after a faster one, and a
    // client whose cursor already passed them would never see those rows.
    const rows = [...latest.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const actor = (access.label ?? access.grantId).slice(0, 80);
    const statements = [
      db.prepare('INSERT OR IGNORE INTO v5_counters (campaign_id, seq) VALUES (?, 0)').bind(campaignId),
      db.prepare('UPDATE v5_counters SET seq = seq + ? WHERE campaign_id = ?').bind(rows.length, campaignId),
    ];
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
      const values: unknown[] = [];
      chunk.forEach((row, j) => values.push(campaignId, row.key, row.id, row.status, row.area, actor, access.grantId, campaignId, rows.length - (i + j + 1)));
      statements.push(db.prepare(
        `INSERT INTO v5_state (campaign_id, key, op_id, status, area_id, actor, grant_id, seq)
         VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,(SELECT seq FROM v5_counters WHERE campaign_id = ?) - ?)').join(',')}
         ON CONFLICT(campaign_id, key) DO UPDATE SET op_id = excluded.op_id, status = excluded.status, area_id = excluded.area_id,
           actor = excluded.actor, grant_id = excluded.grant_id, seq = excluded.seq
         WHERE excluded.op_id > v5_state.op_id${isScoped(access) ? ' AND v5_state.area_id = excluded.area_id' : ''}`,
      ).bind(...values));
    }
    try { await db.batch(statements); } catch { return fail(500, 'write_failed', 'Änderungen konnten nicht gespeichert werden.'); }
  }
  return json({ accepted, rejected });
}

async function geometryHash(geometry: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(geometry)));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getPack(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string, request: Request): Promise<Response> {
  if (!(await canSeeArea(db, access, campaignId, areaId))) return fail(404, 'not_found', 'Gebiet nicht gefunden.');
  type PackMeta = { version: number; chunks: number; total_bytes: number; engine: string };
  const readMeta = () => db.prepare('SELECT version, chunks, total_bytes, engine FROM v5_pack_meta WHERE campaign_id = ? AND area_id = ?').bind(campaignId, areaId).first<PackMeta>();
  let meta = await readMeta();
  if (!meta) return fail(404, 'no_pack', 'Für dieses Gebiet wurde noch kein Kartenpaket erzeugt.');
  // Revalidation is free: the version is the ETag, so an unchanged pack never touches the chunk rows.
  if (request.headers.get('if-none-match') === `"v5-${meta.version}"`) return new Response(null, { status: 304, headers: { etag: `"v5-${meta.version}"`, 'cache-control': 'private, max-age=0, must-revalidate' } });
  const readChunks = (version: number) => db.prepare('SELECT chunk, bytes FROM v5_packs WHERE campaign_id = ? AND area_id = ? AND version = ? ORDER BY chunk ASC').bind(campaignId, areaId, version).all<{ chunk: number; bytes: ArrayBuffer | Uint8Array }>();
  let rows = (await readChunks(meta.version)).results;
  if (rows.length !== meta.chunks) {
    // A rebuild may have swapped versions between the two reads: look once more before failing.
    meta = (await readMeta()) ?? meta;
    rows = (await readChunks(meta.version)).results;
  }
  if (rows.length !== meta.chunks) return fail(500, 'pack_incomplete', 'Kartenpaket unvollständig.');
  const out = new Uint8Array(meta.total_bytes);
  let offset = 0;
  for (const row of rows) { const bytes = new Uint8Array(row.bytes as ArrayBuffer); out.set(bytes, offset); offset += bytes.byteLength; }
  if (offset !== meta.total_bytes) return fail(500, 'pack_corrupt', 'Kartenpaket beschädigt.');
  return new Response(out, { headers: { 'content-type': 'application/gzip', 'cache-control': 'private, max-age=0, must-revalidate', etag: `"v5-${meta.version}"`, 'x-pack-version': String(meta.version), 'x-engine': meta.engine } });
}

async function buildPack(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string, options: V5Options): Promise<Response> {
  const area = await loadCanonicalArea(db, campaignId, areaId);
  if (!area) return fail(404, 'not_found', 'Gebiet nicht gefunden.');
  if (!(access.role === 'admin' || (access.role === 'team-editor' && access.teamId === area.teamId))) return fail(403, 'forbidden', 'Nur Admins oder das Team dürfen das Paket erzeugen.');
  const ring = area.geometry.coordinates[0];
  const bbox = paddedBbox(ring);
  const km2 = ((bbox[2] - bbox[0]) * 110.574) * ((bbox[3] - bbox[1]) * 111.32 * Math.cos((((bbox[0] + bbox[2]) / 2) * Math.PI) / 180));
  if (km2 > MAX_AREA_SQ_KM) return fail(422, 'area_too_large', `Gebiet zu groß (${km2.toFixed(1)} km², max. ${MAX_AREA_SQ_KM}).`);
  // One upstream attempt per Area per minute, claimed atomically *before* the request, so double taps,
  // concurrent callers and failed attempts cannot hammer the shared Overpass service.
  const nowMs = (options.now ?? Date.now)();
  const claim = await db.batch([db.prepare(
    `INSERT INTO v5_pack_attempts (campaign_id, area_id, at) VALUES (?, ?, ?)
     ON CONFLICT(campaign_id, area_id) DO UPDATE SET at = excluded.at WHERE v5_pack_attempts.at <= ?`,
  ).bind(campaignId, areaId, nowMs, nowMs - PACK_REBUILD_COOLDOWN_MS)]);
  if ((claim[0]?.meta?.changes ?? 0) !== 1) return fail(429, 'pack_recent', 'Für dieses Gebiet läuft gerade ein Abruf oder lief eben erst einer. Bitte eine Minute warten.');
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.overpassUrl ?? 'https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'verteil-flyer-v5/1 (flyer distribution field tool)' }, body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
    });
  } catch { return fail(502, 'overpass_unreachable', 'Kartendatenquelle nicht erreichbar.'); }
  if (!response.ok) return fail(502, 'overpass_error', `Kartendatenquelle antwortete mit ${response.status}.`);
  const textBody = await response.text();
  if (textBody.length > (options.maxPackBytes ?? 40_000_000)) return fail(502, 'overpass_too_large', 'Antwort der Kartendatenquelle zu groß.');
  let parsed: ReturnType<typeof packFromOverpass>;
  try { parsed = packFromOverpass(JSON.parse(textBody)); } catch { return fail(502, 'overpass_invalid', 'Antwort der Kartendatenquelle ungültig.'); }
  if (parsed.raw.ways.length === 0 && parsed.raw.buildings.length === 0) return fail(422, 'pack_empty', 'Im Gebiet wurden keine Straßen oder Gebäude gefunden.');
  const bytes = await encodePack(parsed.raw);
  const previous = await db.prepare('SELECT version FROM v5_pack_meta WHERE campaign_id = ? AND area_id = ?').bind(campaignId, areaId).first<{ version: number }>();
  const version = (previous?.version ?? 0) + 1;
  const chunks = Math.ceil(bytes.byteLength / PACK_CHUNK_BYTES);
  const statements = [];
  for (let i = 0; i < chunks; i++) {
    statements.push(db.prepare('INSERT INTO v5_packs (campaign_id, area_id, version, chunk, bytes) VALUES (?, ?, ?, ?, ?)')
      .bind(campaignId, areaId, version, i, bytes.slice(i * PACK_CHUNK_BYTES, (i + 1) * PACK_CHUNK_BYTES)));
  }
  statements.push(db.prepare(`INSERT INTO v5_pack_meta (campaign_id, area_id, version, chunks, total_bytes, engine, stats_json, built_at, geometry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, area_id) DO UPDATE SET version = excluded.version, chunks = excluded.chunks, total_bytes = excluded.total_bytes, engine = excluded.engine, stats_json = excluded.stats_json, built_at = excluded.built_at, geometry_hash = excluded.geometry_hash`)
    .bind(campaignId, areaId, version, chunks, bytes.byteLength, ENGINE_VERSION, JSON.stringify(parsed.stats), new Date(nowMs).toISOString(), await geometryHash(area.geometry)));
  if (previous) statements.push(db.prepare('DELETE FROM v5_packs WHERE campaign_id = ? AND area_id = ? AND version < ?').bind(campaignId, areaId, version));
  try { await db.batch(statements); } catch { return fail(500, 'pack_write_failed', 'Kartenpaket konnte nicht gespeichert werden.'); }
  return json({ version, bytes: bytes.byteLength, chunks, stats: parsed.stats });
}
