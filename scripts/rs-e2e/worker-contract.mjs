// Replays the recorded v5 exchanges (flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json) over real HTTP against a running Worker
// (`BASE=http://localhost:8788`), freshly seeded with v5.seed.sql. Proves the Rust Worker in workerd, with D1, answers like the TypeScript one.
import { readFileSync } from 'node:fs';

const base = process.env.BASE ?? 'http://localhost:8788';
const v = JSON.parse(readFileSync(new URL('../../flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json', import.meta.url), 'utf8'));
const same = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
let failed = 0;
for (const [n, e] of v.exchanges.entries()) {
  const headers = { ...e.headers };
  if (headers.origin === 'https://example.test') headers.origin = base; // "same origin" means the server's own origin
  const res = await fetch(base + e.path, { method: e.method, headers, body: e.body ?? undefined });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* not JSON */ }
  const problems = [];
  if (res.status !== e.status) problems.push(`status ${res.status} instead of ${e.status}`);
  else if (!same(body, e.response)) problems.push(`body differs:\n  got  ${text.slice(0, 300)}\n  want ${JSON.stringify(e.response).slice(0, 300)}`);
  if (res.headers.get('content-type') !== e.contentType) problems.push(`content-type ${res.headers.get('content-type')} instead of ${e.contentType}`);
  if (res.headers.get('cache-control') !== e.cacheControl) problems.push(`cache-control ${res.headers.get('cache-control')} instead of ${e.cacheControl}`);
  if (!res.headers.get('x-request-id')) problems.push('no x-request-id');
  if (problems.length) { failed++; console.log(`FAIL #${n} ${e.who} ${e.method} ${e.path}\n  ${problems.join('\n  ')}`); }
}
console.log(failed ? `${failed} of ${v.exchanges.length} exchanges differ` : `all ${v.exchanges.length} exchanges answered like the TypeScript Worker`);
process.exit(failed ? 1 : 0);
