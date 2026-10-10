import { log } from './state.ts';
import { metrics } from './state.ts';

const ID_SEGMENT = /^[A-Za-z0-9._:~@-]{8,}$/u;

/**
 * `GET /api/v5/campaigns/<id>/areas/<id>/pack?x=1` → `GET /api/v5/campaigns/:c/areas/:a/pack`. Metrics and logs are grouped by this
 * template, so they never contain a campaign or Area id and stay a bounded set of names.
 */
export function routeOf(method: string, url: string): string {
  let path = url;
  try { path = new URL(url, 'http://local').pathname; } catch { /* keep as is */ }
  const parts = path.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const prev = parts[i - 1];
    if (prev === 'campaigns') out.push(':c');
    else if (prev === 'areas') out.push(':a');
    else if (prev === 'collectors' || prev === 'runs' || prev === 'members' || prev === 'grants') out.push(':id');
    else if (ID_SEGMENT.test(parts[i]) && /\d/.test(parts[i]) && parts[i].length > 12) out.push(':id');
    else out.push(parts[i]);
  }
  return `${method.toUpperCase()} /${out.join('/')}`;
}

export const requestId = () => `c-${Math.random().toString(36).slice(2, 10)}`;

/**
 * `fetch` with a request id (the server echoes it into its own log line), outcome counters and a warning for every failure.
 * Timing of the whole transfer comes from the resource-timing observer (it sees the body, which `fetch` hides from us).
 */
export async function tracedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const route = routeOf(method, path);
  const rid = requestId();
  const headers = new Headers(init.headers);
  headers.set('x-request-id', rid);
  const t0 = performance.now();
  metrics.inc('net.requests');
  metrics.set('net.inflight', (metrics.gauge('net.inflight') ?? 0) + 1);
  try {
    const response = await fetch(path, { ...init, headers });
    const ms = Math.round(performance.now() - t0);
    metrics.observe(`net.${route}.headers_ms`, ms);
    metrics.inc(`net.${route}.status.${Math.floor(response.status / 100)}xx`);
    if (!response.ok) log.warn('net', `${route} → ${response.status}`, { rid, server: response.headers.get('x-request-id'), ms });
    else if (ms > 2500) log.warn('net', `${route} slow`, { rid, ms });
    return response;
  } catch (error) {
    metrics.inc(`net.${route}.failed`);
    metrics.inc('net.failed');
    log.warn('net', `${route} failed`, { rid, error: error instanceof Error ? error.message : String(error), online: typeof navigator === 'undefined' ? null : navigator.onLine, ms: Math.round(performance.now() - t0) });
    throw error;
  } finally {
    metrics.set('net.inflight', Math.max(0, (metrics.gauge('net.inflight') ?? 1) - 1));
  }
}
