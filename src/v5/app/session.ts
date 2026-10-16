import { diag } from '../diag/index.ts';

/**
 * An Organisator's session lives 12 hours; the remembered device (a 90-day cookie) buys a new one without a login.
 * The organiser pages do that on a 401 by themselves, the field map did not: after a night the Aktion answered 401
 * and the admin was told to open an invitation link he never had. `call()` now renews the session once and repeats the request.
 */

let pending: Promise<boolean> | null = null;
let lastFailure = 0;
/** After a failed renewal (a team link has no remembered device) nobody asks again for this long. */
const COOLDOWN_MS = 60_000;

async function refreshOnce(url: string): Promise<'ok' | 'rotated' | 'no'> {
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (response.ok) return 'ok';
    if (response.status === 409) return 'rotated'; // another tab renewed it just now: its cookies are on their way
  } catch { /* offline: the caller shows its own error */ }
  return 'no';
}

async function renew(campaignId: string | null): Promise<boolean> {
  const urls = ['/api/organization/session/refresh', ...(campaignId ? [`/api/campaigns/${encodeURIComponent(campaignId)}/admin-accounts/session/refresh`] : [])];
  for (const url of urls) {
    const result = await refreshOnce(url);
    if (result === 'ok' || result === 'rotated') diag.info('net', 'admin session renewed', { via: url.includes('/campaigns/') ? 'campaign-admin' : 'organisation', result });
    if (result === 'ok') return true;
    if (result === 'rotated') { await new Promise<void>((resolve) => setTimeout(resolve, 250)); return true; }
  }
  diag.warn('net', 'admin session could not be renewed (no remembered device, expired or revoked)');
  return false;
}

/** Renews an expired admin session from the remembered device. One request at a time is shared; a failure is remembered for a minute. */
export function renewAdminSession(campaignId: string | null, now: number = Date.now()): Promise<boolean> {
  if (pending) return pending;
  if (now - lastFailure < COOLDOWN_MS) return Promise.resolve(false);
  const run = renew(campaignId).then((ok) => { if (!ok) lastFailure = Date.now(); return ok; }).finally(() => { if (pending === run) pending = null; });
  pending = run;
  return run;
}

/** Test hook. */
export function resetAdminSessionRenewal() { pending = null; lastFailure = 0; }

/** The campaign id of a v5 API path, or null. */
export function campaignOfPath(path: string): string | null {
  const match = /^\/api\/v5\/campaigns\/([^/?#]+)/u.exec(path);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}
