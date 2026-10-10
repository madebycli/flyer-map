import { redactValue } from './redact.ts';
import { log, metrics } from './state.ts';
import { routeOf } from './net.ts';

/** Subsystems describe themselves on demand: a probe returns a plain object when a report is built, and costs nothing otherwise. */
type Probe = () => unknown;
const probes = new Map<string, Probe>();
export function registerProbe(name: string, fn: Probe): () => void {
  probes.set(name, fn);
  return () => { if (probes.get(name) === fn) probes.delete(name); };
}
export function collectProbes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of probes) {
    try { out[name] = redactValue(fn()); } catch (error) { out[name] = { error: error instanceof Error ? error.message : String(error) }; }
  }
  return out;
}

type PerfWithMemory = Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } };
type Nav = Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void }; deviceMemory?: number };

const MB = 1024 * 1024;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function deviceInfo() {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Nav;
  return {
    userAgent: nav.userAgent, platform: nav.platform, language: nav.language,
    viewport: typeof window === 'undefined' ? null : `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: typeof window === 'undefined' ? null : window.devicePixelRatio,
    coarsePointer: typeof matchMedia === 'undefined' ? null : matchMedia('(pointer: coarse)').matches,
    prefersDark: typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)').matches,
    hardwareConcurrency: nav.hardwareConcurrency ?? null, deviceMemoryGb: nav.deviceMemory ?? null,
    online: nav.onLine, secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
    connection: nav.connection ? { effectiveType: nav.connection.effectiveType ?? null, downlinkMbps: nav.connection.downlink ?? null, rttMs: nav.connection.rtt ?? null, saveData: nav.connection.saveData ?? null } : null,
  };
}

/** What the deployment was served with (transfer sizes by kind), from the resource-timing buffer: the cost of a cold start. */
function classify(url: string): string {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* relative */ }
  if (path.startsWith('/api/')) return 'api';
  if (path.endsWith('.wasm')) return 'wasm';
  if (/\.m?js$/.test(path)) return 'js';
  if (path.endsWith('.css')) return 'css';
  if (/\.(png|jpe?g|svg|webp|ico|gif)$/.test(path)) return 'image';
  if (/\.(woff2?|ttf|otf)$/.test(path)) return 'font';
  return 'other';
}

function onResource(entry: PerformanceResourceTiming) {
  let url: URL;
  try { url = new URL(entry.name); } catch { return; }
  if (url.origin !== location.origin) { metrics.inc('res.external.n'); metrics.inc('res.external.bytes', entry.transferSize || 0); return; }
  const kind = classify(entry.name);
  metrics.inc(`res.${kind}.n`);
  metrics.inc(`res.${kind}.bytes`, entry.transferSize || entry.encodedBodySize || 0);
  metrics.inc('res.cached', entry.transferSize === 0 && entry.decodedBodySize > 0 ? 1 : 0);
  if (kind !== 'api') return;
  // The timing entry does not know the method: statistics are per URL template, GET and POST of one route share them.
  const key = routeOf('GET', entry.name).replace(/^GET /, '');
  metrics.observe(`api.${key}.total_ms`, entry.duration);
  if (entry.responseStart && entry.requestStart) metrics.observe(`api.${key}.ttfb_ms`, entry.responseStart - entry.requestStart);
  metrics.observe(`api.${key}.bytes`, entry.transferSize || entry.encodedBodySize || 0);
  for (const timing of (entry as PerformanceResourceTiming & { serverTiming?: { name: string; duration: number }[] }).serverTiming ?? []) {
    if (/^[a-z0-9_-]{1,24}$/i.test(timing.name)) metrics.observe(`api.${key}.server.${timing.name}`, timing.duration);
  }
}

export type BrowserProbes = { setActive(active: boolean): void; stop(): void };

/**
 * Cheap sensors that run for the whole page life (long tasks, resource timing, connectivity and lifecycle events), and expensive ones
 * (a frame sampler, heap and storage polling) that run only while somebody is looking (`setActive(true)`).
 */
export function startBrowserProbes(): BrowserProbes {
  const stops: (() => void)[] = [];
  const add = (target: EventTarget | undefined | null, type: string, fn: () => void) => { if (!target) return; target.addEventListener(type, fn); stops.push(() => target.removeEventListener(type, fn)); };

  try {
    const longTasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.inc('longtask.n'); metrics.observe('longtask.ms', entry.duration);
        if (entry.duration >= 200) log.warn('device', 'long task', { ms: Math.round(entry.duration) });
      }
    });
    longTasks.observe({ type: 'longtask', buffered: true });
    stops.push(() => longTasks.disconnect());
  } catch { /* not supported (Safari) */ }
  try {
    const resources = new PerformanceObserver((list) => { for (const entry of list.getEntries()) onResource(entry as PerformanceResourceTiming); });
    resources.observe({ type: 'resource', buffered: true });
    stops.push(() => resources.disconnect());
  } catch { /* not supported */ }

  const online = () => { metrics.set('net.online', navigator.onLine ? 1 : 0); metrics.inc(navigator.onLine ? 'net.online.n' : 'net.offline.n'); log.info('net', navigator.onLine ? 'online' : 'offline'); };
  metrics.set('net.online', navigator.onLine ? 1 : 0);
  add(window, 'online', online); add(window, 'offline', online);
  add(document, 'visibilitychange', () => { metrics.inc(`page.${document.visibilityState}`); log.info('device', `page ${document.visibilityState}`); });
  add(window, 'pagehide', () => log.info('device', 'pagehide'));
  add(document, 'freeze', () => log.info('device', 'page frozen'));
  add(document, 'resume', () => log.info('device', 'page resumed'));
  add(window, 'resize', () => metrics.set('device.viewportWidth', window.innerWidth));
  add((navigator as Nav).connection as unknown as EventTarget | undefined, 'change', () => log.info('net', 'connection changed', deviceInfo().connection));

  // --- sensors that cost something: only while somebody looks ---
  let active = false;
  let raf = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = 0, windowStart = 0, frames = 0;
  const recent: { t: number; dt: number }[] = [];
  const frame = (t: number) => {
    if (!active) return;
    if (last) {
      const dt = t - last;
      frames++; recent.push({ t, dt });
      if (dt > 32) metrics.inc('render.frames.over32ms');
      if (dt > 100) metrics.inc('render.frames.over100ms');
    }
    last = t;
    if (!windowStart) windowStart = t;
    if (t - windowStart >= 1000) {
      const fps = (frames * 1000) / (t - windowStart);
      metrics.set('render.fps', round1(fps)); metrics.observe('render.fps.samples', fps);
      while (recent.length && t - recent[0].t > 5000) recent.shift();
      metrics.set('render.worstFrameMs5s', round1(recent.reduce((m, r) => Math.max(m, r.dt), 0)));
      metrics.set('render.framesOver32ms5s', recent.filter((r) => r.dt > 32).length);
      windowStart = t; frames = 0;
    }
    raf = requestAnimationFrame(frame);
  };
  const sample = () => {
    const memory = (performance as PerfWithMemory).memory;
    if (memory?.usedJSHeapSize) { metrics.set('mem.heapMb', round1(memory.usedJSHeapSize / MB)); metrics.observe('mem.heapMb.samples', memory.usedJSHeapSize / MB); if (memory.jsHeapSizeLimit) metrics.set('mem.heapLimitMb', Math.round(memory.jsHeapSizeLimit / MB)); }
    void navigator.storage?.estimate?.().then((e) => { if (e.usage !== undefined) metrics.set('storage.usageMb', round1(e.usage / MB)); if (e.quota !== undefined) metrics.set('storage.quotaMb', Math.round(e.quota / MB)); }, () => {});
  };
  return {
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      if (next) { last = 0; windowStart = 0; frames = 0; raf = requestAnimationFrame(frame); sample(); timer = setInterval(sample, 5000); }
      else { cancelAnimationFrame(raf); if (timer) clearInterval(timer); timer = null; }
    },
    stop() { this.setActive(false); for (const stop of stops) stop(); stops.length = 0; },
  };
}

let gl: Record<string, unknown> | null = null;
/** The graphics stack of the device (once; a throwaway context that is released right away): the first thing to read when a map is slow or blank. */
export function webglInfo(): Record<string, unknown> {
  if (gl) return gl;
  gl = { available: false };
  try {
    const canvas = document.createElement('canvas');
    const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (ctx) {
      const info = ctx.getExtension('WEBGL_debug_renderer_info');
      gl = {
        available: true, version: ctx.getParameter(ctx.VERSION), renderer: info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : null, vendor: info ? ctx.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
        maxTextureSize: ctx.getParameter(ctx.MAX_TEXTURE_SIZE), maxVertexAttribs: ctx.getParameter(ctx.MAX_VERTEX_ATTRIBS), webgl2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
      };
      ctx.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* leave the default */ }
  return gl;
}
