import type { FieldStore } from './store.ts';
import type { Op } from './types.ts';
import { diag } from '../diag/index.ts';

/** Anything else that rides the same loop (notes): one round of push + pull, plus a way to be woken by local edits. */
export interface SyncExtra {
  syncOnce(): Promise<void>;
  subscribe(listener: () => void): () => void;
  pendingCount(): number;
}

export interface SyncTransport {
  pull(since: number): Promise<{ ops: Op[]; cursor: number; serverNow?: number }>;
  /** `rejected` edits are permanently refused and get rolled back locally. */
  /** `refetch`: the refusal means the server holds another truth for some key (it belongs to another Area): pull everything again so the screen shows it. */
  push(ops: Op[]): Promise<{ accepted: string[]; rejected?: string[]; refetch?: boolean; cursor: number }>;
}

/**
 * Tiny outbox/inbox loop. Because ops are idempotent and LWW, there is no retry
 * bookkeeping to get wrong: failed pushes stay in the persisted outbox and are
 * simply sent again. Pulls are cursor based and may overlap harmlessly.
 */
export type SyncInfo = { lastOkAt: number | null; lastError: string | null };
/** One line per sync round, newest last (kept short: the panel shows the last ones, the log has the details). */
export type SyncRound = { at: number; ms: number; batches: number; sent: number; accepted: number; rejected: number; pages: number; pulled: number; result: 'ok' | 'notes-failed' | 'failed'; error?: string };
const HISTORY = 30;
const describe = (error: unknown) => (error instanceof Error ? error.message : 'Unbekannter Fehler').slice(0, 160);
/** For the diagnostics: a server answer as `status code` (e.g. `403 cross_origin`), which survives redaction; anything else as its (redacted) message. The person sees `describe`. */
const errorCode = (error: unknown) => {
  const api = error as { status?: unknown; code?: unknown } | null;
  return api && typeof api.status === 'number' && typeof api.code === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(api.code) ? `${api.status} ${api.code}` : describe(error);
};

export class SyncClient {
  private running = false;
  private again = false;
  private failures = 0;
  private extraFailed = false;
  private extraFailures = 0;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private unsubscribers: (() => void)[];
  readonly history: SyncRound[] = [];
  private backoffMs = 0;
  private stopProbe: (() => void) | null = null;
  state: 'idle' | 'syncing' | 'offline' = 'idle';
  /** When the last full round trip succeeded, and why the last one failed (null while healthy): shown in the overview. */
  lastOkAt: number | null = null;
  lastError: string | null = null;
  private lastErrorCode: string | null = null;

  constructor(
    private readonly store: FieldStore,
    private readonly transport: SyncTransport,
    private readonly batchSize = 200,
    private readonly onState: (state: SyncClient['state'], pending: number, info: SyncInfo) => void = () => {},
    private readonly extras: SyncExtra[] = [],
  ) {
    this.unsubscribers = [store.subscribe(() => this.kick()), ...extras.map((extra) => extra.subscribe(() => this.kick()))];
    this.stopProbe = diag.probe('sync', () => ({
      state: this.state, running: this.running, lastOkAgoS: this.lastOkAt ? Math.round((Date.now() - this.lastOkAt) / 1000) : null, lastError: this.lastErrorCode, failures: this.failures, extraFailures: this.extraFailures,
      backoffMs: this.backoffMs, retryScheduled: !!this.retryTimer, pendingOps: this.store.pendingOps().length, pendingNotes: this.extras.reduce((n, extra) => n + extra.pendingCount(), 0),
      batchSize: this.batchSize, rounds: [...this.history],
    }));
  }

  kick(): void {
    if (this.kickTimer || this.disposed) return;
    this.kickTimer = setTimeout(() => { this.kickTimer = null; void this.run(); }, 50);
  }

  async run(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    const fresh = (): SyncRound => ({ at: Date.now(), ms: 0, batches: 0, sent: 0, accepted: 0, rejected: 0, pages: 0, pulled: 0, result: 'ok' });
    let round = fresh();
    let t0 = performance.now();
    const finish = (result: SyncRound['result'], error?: string) => {
      round.ms = Math.round(performance.now() - t0); round.result = result; if (error) round.error = error;
      this.history.push(round); if (this.history.length > HISTORY) this.history.shift();
      diag.inc('sync.rounds'); diag.observe('sync.round_ms', round.ms);
      diag.inc(`sync.result.${result}`);
    };
    try {
      do {
        this.again = false;
        round = fresh(); t0 = performance.now();
        this.set('syncing');
        for (let ops = this.store.pendingOps(); ops.length; ops = this.store.pendingOps()) {
          const batch = ops.slice(0, this.batchSize);
          const tPush = performance.now();
          const result = await this.transport.push(batch);
          round.batches++; round.sent += batch.length; round.accepted += result.accepted.length; round.rejected += result.rejected?.length ?? 0;
          diag.inc('sync.push.batches'); diag.inc('sync.push.sent', batch.length); diag.inc('sync.push.accepted', result.accepted.length); diag.observe('sync.push_ms', performance.now() - tPush);
          if (result.rejected?.length) { diag.inc('sync.push.rejected', result.rejected.length); diag.warn('sync', 'edits refused by the server', { count: result.rejected.length, refetch: !!result.refetch }); }
          if (result.refetch) diag.inc('sync.refetch');
          // The push cursor must not advance the pull cursor: it would skip other clients' ops.
          this.store.acknowledge(result.accepted);
          if (result.rejected?.length) this.store.rollback(result.rejected);
          if (result.refetch) this.store.rewindCursor();
          if (!result.accepted.length && !result.rejected?.length) break;
        }
        for (;;) {
          const tPull = performance.now();
          const { ops, cursor, serverNow } = await this.transport.pull(this.store.lastCursor);
          round.pages++; round.pulled += ops.length;
          diag.inc('sync.pull.pages'); diag.inc('sync.pull.ops', ops.length); diag.observe('sync.pull_ms', performance.now() - tPull);
          if (serverNow !== undefined) this.store.syncClock(serverNow);
          this.store.receive(ops, cursor);
          if (!ops.length || cursor <= 0) break;
        }
        // Notes ride the same loop but must not make the status sync look offline (or the reverse): isolate and retry.
        for (const extra of this.extras) {
          try { await extra.syncOnce(); } catch (error) { this.extraFailed = true; this.lastError = `Notizen: ${describe(error)}`; this.lastErrorCode = `Notizen: ${errorCode(error)}`; diag.warn('sync', 'notes sync failed', { error: errorCode(error) }); }
        }
        if (this.extraFailed) {
          this.extraFailed = false;
          this.extraFailures++;
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.backoffMs = Math.min(60_000, 1000 * 2 ** this.extraFailures);
          this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.run(); }, this.backoffMs);
        } else { this.extraFailures = 0; this.lastError = null; this.lastErrorCode = null; this.backoffMs = 0; }
        const recovered = this.failures > 0;
        this.failures = 0;
        this.lastOkAt = Date.now();
        diag.set('sync.lastOkAt', this.lastOkAt);
        if (recovered) diag.info('sync', 'sync recovered');
        finish(this.extraFailed || this.extraFailures ? 'notes-failed' : 'ok');
        this.set('idle');
      } while (this.again);
    } catch (error) {
      if (!this.disposed) {
        this.failures++;
        this.lastError = describe(error); this.lastErrorCode = errorCode(error);
        this.set('offline');
        // Exponential backoff, capped; pending ops stay safely in the persisted outbox.
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.backoffMs = Math.min(30_000, 500 * 2 ** this.failures);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.run(); }, this.backoffMs);
        diag.inc('sync.failures');
        diag.warn('sync', 'sync failed, retrying', { error: errorCode(error), failures: this.failures, retryInMs: this.backoffMs, pending: this.store.pendingOps().length });
        finish('failed', errorCode(error));
      }
    } finally {
      this.running = false;
    }
  }

  private set(state: SyncClient['state']) { if (!this.disposed) { if (state !== this.state) diag.debug('sync', `state ${this.state} → ${state}`); this.state = state; diag.set('sync.state', state === 'idle' ? 0 : state === 'syncing' ? 1 : 2); this.onState(state, this.store.pendingOps().length + this.extras.reduce((n, extra) => n + extra.pendingCount(), 0), { lastOkAt: this.lastOkAt, lastError: this.lastError }); } }
  dispose() {
    this.disposed = true;
    this.stopProbe?.();
    for (const off of this.unsubscribers) off();
    if (this.kickTimer) clearTimeout(this.kickTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.kickTimer = this.retryTimer = null;
  }
}
