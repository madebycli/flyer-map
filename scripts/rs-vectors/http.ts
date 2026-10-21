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

type Exchange = { who: string | null; method: string; path: string; headers: Record<string, string>; body: string | null; status: number; response: unknown; contentType: string | null; cacheControl: string | null };
const exchanges: Exchange[] = [];
async function call(who: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { ...(who ? { cookie: cookies[who] } : {}), ...(text !== null ? { 'content-type': 'application/json' } : {}), ...extra };
  const res = (await handleV5Api(new Request(`https://example.test${path}`, { method, headers, body: text ?? undefined }), db, { now: () => NOW }))!;
  const raw = await res.text();
  let response: unknown = raw;
  try { response = JSON.parse(raw); } catch { /* not JSON */ }
  exchanges.push({ who, method, path, headers, body: text, status: res.status, response, contentType: res.headers.get('content-type'), cacheControl: res.headers.get('cache-control') });
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
await call('admin', 'GET', `/api/v5/campaigns/${encodeURIComponent('bad id!')}/state`);
await call('admin', 'GET', `/api/v5/campaigns/campaign_missing/meta`);

const seedFile = new URL('v5.seed.sql', DIR);
const text = `${JSON.stringify({ about: 'made by scripts/rs-vectors/http.ts from the TypeScript Worker; do not edit', now: NOW, cookies, exchanges }, null, 1)}\n`;
const file = new URL('v5.json', DIR);
writeFileSync(file, text);
writeFileSync(seedFile, seedSql);
console.log(`wrote ${exchanges.length} exchanges`);
