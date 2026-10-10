import { collectProbes, deviceInfo } from './probes.ts';
import type { PreviousSession } from './persist.ts';
import { REPORT_LIMITS, redactValue } from './redact.ts';
import { log, metrics } from './state.ts';

export const REPORT_SCHEMA = 'v5-diag-1';

export type Session = { id: string; startedAt: number; bootCount: number; previous: PreviousSession | null };

const QUERY_KEEP = new Set(['engine', 'diag', 'debug', 'kind']);

/** The page address without anything that identifies the Aktion: only the switches that change behaviour. */
function flags(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(location.search)) if (QUERY_KEEP.has(key)) out[key] = value.slice(0, 20);
  return out;
}

/**
 * One JSON document that answers "what happened on this device": identity of the build, the device, every counter and timing
 * since the page started, what each subsystem reports about itself, and the log. Redacted as a whole before it leaves.
 */
export function buildReport(session: Session, options: { logLimit?: number } = {}) {
  const raw = {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    run: { id: session.id, startedAt: new Date(session.startedAt).toISOString(), uptimeS: Math.round((Date.now() - session.startedAt) / 1000), bootCount: session.bootCount },
    flags: flags(),
    device: deviceInfo(),
    metrics: metrics.snapshot(),
    subsystems: collectProbes(),
    log: { counts: { ...log.counts }, verbose: log.verbose, entries: log.entries({ limit: options.logLimit ?? 300 }) },
    previousSession: session.previous ? { id: session.previous.session, endedAt: new Date(session.previous.endedAt).toISOString(), entries: session.previous.entries } : null,
  };
  return redactValue(JSON.parse(JSON.stringify(raw)), -20, REPORT_LIMITS) as typeof raw;
}

export type Report = ReturnType<typeof buildReport>;
