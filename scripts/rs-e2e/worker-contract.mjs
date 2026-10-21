// Replays the recorded v5 exchanges (flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json) over real HTTP against a running Worker
// (`BASE=http://localhost:8788`), freshly seeded with v5.seed.sql. Proves the Rust Worker in workerd, with D1, answers like the TypeScript one.
// Ids and secrets are random on both sides: the replay pairs them up the first time it sees them (as tests/randoms/mod.rs does natively).
import { readFileSync } from 'node:fs';

const base = process.env.BASE ?? 'http://localhost:8788';
const v = JSON.parse(readFileSync(new URL('../../flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json', import.meta.url), 'utf8'));

const pairs = new Map(); // recorded → ours
const rewrite = (text) => [...pairs].reduce((t, [recorded, ours]) => t.replaceAll(recorded, ours), text);
const pair = (recorded, ours) => (pairs.has(recorded) ? pairs.get(recorded) === ours : [...pairs.values()].includes(ours) ? false : (pairs.set(recorded, ours), true));
const isRandom = (key, value) => key === 'joinSecret' || /^(room|grant|session)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) || /^[0-9a-z]{11}-[0-9a-z]{4}-srv[0-9a-f]{6}$/u.test(value);
function same(recorded, ours, key = null) {
  // a tombstone id: the clock part is deterministic, only the node is random
  if (typeof recorded === 'string' && typeof ours === 'string' && isRandom(key, recorded)) return (!/-srv/u.test(recorded) || recorded.slice(0, 20) === ours.slice(0, 20)) && pair(recorded, ours);
  if (Array.isArray(recorded)) return Array.isArray(ours) && recorded.length === ours.length && recorded.every((r, i) => same(r, ours[i], key));
  if (recorded && typeof recorded === 'object') {
    if (!ours || typeof ours !== 'object' || Array.isArray(ours)) return false;
    const keys = Object.keys(recorded);
    return keys.length === Object.keys(ours).length && keys.every((k) => k in ours && same(recorded[k], ours[k], k));
  }
  return recorded === ours;
}
function sameCookie(recorded, ours) {
  if (!recorded || !ours) return !recorded && !ours;
  const split = (c) => /^([^=;]+)=([^;]*)(;.*)$/u.exec(c);
  const [r, o] = [split(recorded), split(ours)];
  return !!r && !!o && r[1] === o[1] && r[3] === o[3] && pair(r[2], o[2]);
}

let failed = 0;
for (const [n, e] of v.exchanges.entries()) {
  const headers = Object.fromEntries(Object.entries(e.headers).map(([k, value]) => [k, rewrite(value)]));
  if (headers.origin === 'https://example.test') headers.origin = base; // "same origin" means the server's own origin
  const res = await fetch(base + rewrite(e.path), { method: e.method, headers, body: e.body === null ? undefined : rewrite(e.body) });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* not JSON */ }
  const problems = [];
  if (res.status !== e.status) problems.push(`status ${res.status} instead of ${e.status}`);
  else if (!same(e.response, body)) problems.push(`body differs:\n  got  ${text.slice(0, 300)}\n  want ${JSON.stringify(e.response).slice(0, 300)}`);
  if (res.headers.get('content-type') !== e.contentType) problems.push(`content-type ${res.headers.get('content-type')} instead of ${e.contentType}`);
  if (res.headers.get('cache-control') !== e.cacheControl) problems.push(`cache-control ${res.headers.get('cache-control')} instead of ${e.cacheControl}`);
  if (!sameCookie(e.setCookie ?? null, res.headers.get('set-cookie'))) problems.push(`set-cookie ${res.headers.get('set-cookie')} instead of ${e.setCookie}`);
  if (!res.headers.get('x-request-id')) problems.push('no x-request-id');
  if (problems.length) { failed++; console.log(`FAIL #${n} ${e.who} ${e.method} ${e.path}\n  ${problems.join('\n  ')}`); }
}
console.log(failed ? `${failed} of ${v.exchanges.length} exchanges differ` : `all ${v.exchanges.length} exchanges answered like the TypeScript Worker`);
process.exit(failed ? 1 : 0);
