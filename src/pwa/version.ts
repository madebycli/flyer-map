/** The version of this build and the check against the one that is online. */
export type Latest = { version: string; build: string; sha: string };

const defined = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback);
export const APP: Latest = {
  version: defined(typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__, 'dev'),
  build: defined(typeof __APP_BUILD__ === 'undefined' ? undefined : __APP_BUILD__, '0'),
  sha: defined(typeof __APP_SHA__ === 'undefined' ? undefined : __APP_SHA__, ''),
};

/** What the server publishes at `/version.json`; null when it cannot be read in time (offline, slow, not a build). */
export async function fetchLatest(timeoutMs = 3000, fetchImpl: typeof fetch = fetch): Promise<Latest | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/version.json', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<Latest> | null;
    return body && typeof body.build === 'string' && /^\d+$/.test(body.build) && typeof body.version === 'string'
      ? { version: body.version, build: body.build, sha: typeof body.sha === 'string' ? body.sha : '' }
      : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Newer only when both are real build numbers and the online one is higher: a development build or an older deploy never triggers an update. */
export function isNewer(latest: Latest, current: Latest = APP): boolean {
  return /^\d+$/.test(latest.build) && /^[1-9]\d*$/.test(current.build) && Number(latest.build) > Number(current.build);
}

/** Short text for the menu: `v5.7.501`. */
export const versionLabel = (current: Latest = APP) => (current.version === 'dev' ? 'Entwicklung' : `v${current.version}`);
