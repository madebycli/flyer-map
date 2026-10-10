import type { Category, Level } from './log.ts';
import { bumpBootCount, diagFlag, loadPrevious, saveTail } from './persist.ts';
import { startBrowserProbes, type BrowserProbes, registerProbe } from './probes.ts';
import { buildReport, type Report, type Session } from './report.ts';
import { log, metrics } from './state.ts';
import { foreignMessage, whereOf } from './redact.ts';

export { log, metrics } from './state.ts';
export { registerProbe, collectProbes, deviceInfo } from './probes.ts';
export { routeOf, tracedFetch } from './net.ts';
export { buildReport, REPORT_SCHEMA, type Report } from './report.ts';
export { copyText, downloadText } from './clipboard.ts';
export { LEVELS, CATEGORIES, type Entry, type Level, type Category } from './log.ts';
export { diagFlag } from './persist.ts';

let session: Session | null = null;
let probes: BrowserProbes | null = null;

/** `?diag=1` in the address, or the switch left on in the panel: verbose logging, the HUD, and the frame/heap sensors from the start. */
export function diagRequested(): boolean {
  try { return (typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1') || diagFlag.read(); } catch { return false; }
}

const sessionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Idempotent. Call once, as early as possible: it installs the global error nets and the cheap sensors. */
export function initDiag(): Session {
  if (session) return session;
  session = { id: sessionId(), startedAt: Date.now(), bootCount: bumpBootCount(), previous: loadPrevious() };
  const id = session.id;
  log.verbose = diagRequested();
  log.onSticky = (entries) => saveTail(id, entries);
  if (typeof window === 'undefined') return session;

  window.addEventListener('error', (event) => {
    log.error('error', 'uncaught error', { where: whereOf(event.filename, event.lineno, event.colno), message: event.error ?? event.message });
    metrics.inc('errors.window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    log.error('error', 'unhandled rejection', { reason: event.reason instanceof Error ? event.reason : String(event.reason ?? '') });
    metrics.inc('errors.unhandledRejection');
  });
  // The libraries (MapLibre) report their trouble on the console: keep it in the log, and still print it.
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try { log.log(level, 'console', `console.${level}`, { message: foreignMessage(typeof args[0] === 'string' || args[0] instanceof Error ? args[0] : ''), args: args.length }); } catch { /* never throw from the logger */ }
    };
  }
  probes = startBrowserProbes();
  if (diagRequested()) probes.setActive(true);
  registerProbe('app', () => ({ boot: (window as unknown as { __v5Boot?: unknown }).__v5Boot ?? null, search: location.search ? [...new URLSearchParams(location.search).keys()].filter((k) => ['engine', 'diag', 'debug', 'kind'].includes(k)) : [] }));
  log.info('boot', 'session start', { session: id, bootCount: session.bootCount, previousTail: session.previous?.entries.length ?? 0, verbose: log.verbose });
  return session;
}

/** The panel (and the HUD) call this while visible: the frame sampler and the heap poll run only then. */
export function setObserving(on: boolean) { probes?.setActive(on || diagRequested()); }

const modeListeners = new Set<() => void>();
/** For `useSyncExternalStore`: the readout appears and disappears the moment the switch changes, not at the next start. */
export const subscribeDiagMode = (listener: () => void) => { modeListeners.add(listener); return () => { modeListeners.delete(listener); }; };
/** True when the address itself asks for diagnostics (`?diag=1`): that one cannot be switched off from inside the page. */
export const diagFromAddress = (): boolean => { try { return new URLSearchParams(location.search).get('diag') === '1'; } catch { return false; } };

export function setVerbose(on: boolean) {
  diagFlag.write(on); log.verbose = diagRequested(); if (on) probes?.setActive(true);
  for (const listener of modeListeners) listener();
}

export function report(options?: { logLimit?: number }): Report { return buildReport(session ?? initDiag(), options); }
export function currentSession(): Session { return session ?? initDiag(); }

/** Short helpers for call sites. */
export const diag = {
  debug: (cat: Category, msg: string, data?: unknown) => log.debug(cat, msg, data),
  info: (cat: Category, msg: string, data?: unknown) => log.info(cat, msg, data),
  warn: (cat: Category, msg: string, data?: unknown) => log.warn(cat, msg, data),
  error: (cat: Category, msg: string, data?: unknown) => log.error(cat, msg, data),
  log: (lvl: Level, cat: Category, msg: string, data?: unknown) => log.log(lvl, cat, msg, data),
  inc: (name: string, by?: number) => metrics.inc(name, by),
  set: (name: string, value: number) => metrics.set(name, value),
  observe: (name: string, value: number) => metrics.observe(name, value),
  start: (name: string) => metrics.start(name),
  time: <T>(name: string, fn: () => Promise<T>) => metrics.time(name, fn),
  probe: registerProbe,
};
export { webglInfo } from './probes.ts';
export { whereOf, urlKind, foreignMessage } from './redact.ts';
