import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from '../campaignRepository.ts';

/**
 * What the server says about itself, with the same discipline as the client's diagnostics: no ids, no names, no coordinates, no query strings,
 * no cookies, no request bodies. A line carries the route *template*, method, status, duration, database time and an error code.
 *
 * - `x-request-id`: the client sends one, the server echoes it (or makes one) and prints it, so a failing request can be found on both sides.
 * - `Server-Timing`: `total` and `db` (with the query count) reach the browser without any extra request; the client's Netz tab shows them.
 * - One JSON line per request at or above the configured level (`V5_LOG_LEVEL`, default `warn`: only problems are written).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function logLevelFrom(value: string | undefined): LogLevel {
  const v = value?.trim().toLowerCase();
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'warn';
}

const REQUEST_ID = /^[A-Za-z0-9_-]{6,40}$/u;
/** The client's id if it is well-formed (it ends up in a log line and a header, so it is never taken verbatim), else a fresh one. */
export function requestIdOf(request: Request): string {
  const given = request.headers.get('x-request-id');
  if (given && REQUEST_ID.test(given)) return given;
  return `s-${crypto.randomUUID().slice(0, 12)}`;
}

const ORIGINAL = Symbol('original statement');

export type DbStats = { queries: number; batches: number; ms: number; slowestMs: number };

/** The database as the handlers see it, with every call counted and timed. D1 semantics are untouched: `bind` still returns a statement. */
export function instrumentDb(db: D1DatabaseLike, clock: () => number = () => performance.now()): { db: D1DatabaseLike; stats: DbStats } {
  const stats: DbStats = { queries: 0, batches: 0, ms: 0, slowestMs: 0 };
  const timed = async <T>(run: () => Promise<T>, queries: number, batch = false): Promise<T> => {
    const t0 = clock();
    try { return await run(); } finally {
      const took = clock() - t0;
      stats.queries += queries; if (batch) stats.batches++; stats.ms += took; if (took > stats.slowestMs) stats.slowestMs = took;
    }
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const full = statement as D1PreparedStatement & { run?: () => Promise<unknown>; raw?: (...a: unknown[]) => Promise<unknown> };
    const out: Record<string, unknown> = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: <T,>(...column: [string?]) => timed(() => (column.length ? (statement as unknown as { first(c: string): Promise<T | null> }).first(column[0] as string) : statement.first<T>()), 1),
      all: <T,>() => timed(() => statement.all<T>(), 1),
    };
    if (full.run) out.run = () => timed(() => full.run!(), 1);
    if (full.raw) out.raw = (...a: unknown[]) => timed(() => full.raw!(...a), 1);
    // The batch needs the statement it was made from, not the wrapper.
    Object.defineProperty(out, ORIGINAL, { value: statement });
    return out as unknown as D1PreparedStatement;
  };
  const wrapped: D1DatabaseLike = {
    prepare: (query: string) => wrap(db.prepare(query)),
    batch: (statements: D1PreparedStatement[]): Promise<D1RunResult[]> => timed(() => db.batch(statements.map((s) => (s as unknown as Record<symbol, D1PreparedStatement>)[ORIGINAL] ?? s)), statements.length, true),
  };
  return { db: wrapped, stats };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function serverTiming(totalMs: number, stats: DbStats): string {
  return `total;dur=${round(totalMs)}, db;dur=${round(stats.ms)};desc="${stats.queries} queries${stats.batches ? `, ${stats.batches} batch` : ''}"`;
}

export type RequestLine = { rid: string; route: string; method: string; status: number; ms: number; db: DbStats; code?: string; bytes?: number };

export function lineLevel(line: RequestLine): LogLevel {
  if (line.status >= 500) return 'error';
  if (line.status >= 400) return 'warn';
  if (line.ms > 1500 || line.db.ms > 800) return 'warn'; // slow is a finding too
  return 'info';
}

/** The text of a log line; exported so a test can read exactly what would be written. */
export function formatLine(line: RequestLine, level: LogLevel): string {
  return JSON.stringify({
    lvl: level, msg: 'v5 request', rid: line.rid, route: line.route, method: line.method, status: line.status, ms: round(line.ms),
    db: { queries: line.db.queries, batches: line.db.batches, ms: round(line.db.ms), slowestMs: round(line.db.slowestMs) },
    ...(line.code ? { code: line.code } : {}), ...(line.bytes != null ? { bytes: line.bytes } : {}),
  });
}

export type Sink = (level: LogLevel, text: string) => void;
export const consoleSink: Sink = (level, text) => { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(text); };

export function emit(line: RequestLine, threshold: LogLevel, sink: Sink = consoleSink): void {
  const level = lineLevel(line);
  if (ORDER[level] >= ORDER[threshold]) sink(level, formatLine(line, level));
}

/** The error code of a failed response (`{ error: { code } }`), read from a clone and only for 4xx/5xx; never the message, which may quote input. */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  if (response.status < 400) return undefined;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    const code = body?.error?.code;
    return typeof code === 'string' && /^[a-z0-9_.-]{1,60}$/u.test(code) ? code : undefined;
  } catch { return undefined; }
}
