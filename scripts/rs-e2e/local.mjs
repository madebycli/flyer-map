// Helpers of the flows that run against the local Worker (scripts/rs-e2e/app-local.sh): the made-up test sessions of the contract vectors, building the map
// data of the seeded Gebiete through the Worker (from the stub's made-up neighbourhood), and reading the server's state to check what the app wrote.
// The tokens are those of the recorded test data (flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json); nothing here is a secret and nothing is copied out.
import { readFileSync } from 'node:fs';

const vectors = JSON.parse(readFileSync(new URL('../../flyermap-rs/crates/flyermap-worker/tests/vectors/v5.json', import.meta.url), 'utf8'));
export const CAMPAIGN = 'campaign_n';
export const WORKER = process.env.WORKER ?? 'http://127.0.0.1:8790';
export const APP = process.env.BASE ?? 'http://127.0.0.1:8160/';

/** `who`: admin, editor (Gruppe "Team"), viewer, other (Gruppe "Other"). */
export function sessionCookie(who) {
  const [name, ...rest] = vectors.cookies[who].split('=');
  return { name, value: rest.join('=') };
}

/** A browser context that carries the session of `who` on the app's origin. */
export async function contextAs(browser, who, options = {}) {
  const context = await browser.newContext(options);
  const { name, value } = sessionCookie(who);
  await context.addCookies([{ name, value, url: APP }]);
  return context;
}

const headers = (who) => ({ cookie: `${sessionCookie(who).name}=${sessionCookie(who).value}`, origin: WORKER, 'content-type': 'application/json' });

export async function api(who, path, init = {}) {
  const res = await fetch(`${WORKER}/api/v5/campaigns/${CAMPAIGN}${path}`, { headers: headers(who), ...init });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}

/** The server's shared state (what every device sees), as `{key: status}`. */
export async function serverStatuses(who = 'admin') {
  const out = {};
  let since = 0;
  for (;;) {
    const { body } = await api(who, `/state?since=${since}&limit=1000`);
    for (const op of body.ops) out[op.key] = op.status;
    if (!body.more) return out;
    since = body.cursor;
  }
}

/** Build the map data of the Gebiete the vectors seed with dummy bytes, so there is a real pack to load (the stub answers the Worker's Overpass query). */
export async function buildPacks(areas = ['area_n', 'area_o']) {
  for (const area of areas) {
    const r = await api('admin', `/areas/${area}/pack`, { method: 'POST', body: '{}' });
    // 429: built a moment ago (the Worker allows one build per Gebiet and minute): the pack is real already
    if (r.status !== 200 && r.status !== 429) throw new Error(`building the pack of ${area}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}
