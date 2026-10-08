import type { FieldStore } from './store.ts';
import type { Op } from './types.ts';

/** Anything else that rides the same loop (notes): one round of push + pull, plus a way to be woken by local edits. */
export interface SyncExtra {
  syncOnce(): Promise<void>;
  subscribe(listener: () => void): () => void;
  pendingCount(): number;
}

export interface SyncTransport {
  pull(since: number): Promise<{ ops: Op[]; cursor: number; serverNow?: number }>;
  /** `rejected` edits are permanently refused and get rolled back locally. */
  push(ops: Op[]): Promise<{ accepted: string[]; rejected?: string[]; cursor: number }>;
}

/**
 * Tiny outbox/inbox loop. Because ops are idempotent and LWW, there is no retry
 * bookkeeping to get wrong: failed pushes stay in the persisted outbox and are
 * simply sent again. Pulls are cursor based and may overlap harmlessly.
 */
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
  state: 'idle' | 'syncing' | 'offline' = 'idle';

  constructor(
    private readonly store: FieldStore,
    private readonly transport: SyncTransport,
    private readonly batchSize = 200,
    private readonly onState: (state: SyncClient['state'], pending: number) => void = () => {},
    private readonly extras: SyncExtra[] = [],
  ) {
    this.unsubscribers = [store.subscribe(() => this.kick()), ...extras.map((extra) => extra.subscribe(() => this.kick()))];
  }

  kick(): void {
    if (this.kickTimer || this.disposed) return;
    this.kickTimer = setTimeout(() => { this.kickTimer = null; void this.run(); }, 50);
  }

  async run(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        this.set('syncing');
        for (let ops = this.store.pendingOps(); ops.length; ops = this.store.pendingOps()) {
          const batch = ops.slice(0, this.batchSize);
          const result = await this.transport.push(batch);
          // The push cursor must not advance the pull cursor: it would skip other clients' ops.
          this.store.acknowledge(result.accepted);
          if (result.rejected?.length) this.store.rollback(result.rejected);
          if (!result.accepted.length && !result.rejected?.length) break;
        }
        for (;;) {
          const { ops, cursor, serverNow } = await this.transport.pull(this.store.lastCursor);
          if (serverNow !== undefined) this.store.syncClock(serverNow);
          this.store.receive(ops, cursor);
          if (!ops.length || cursor <= 0) break;
        }
        // Notes ride the same loop but must not make the status sync look offline (or the reverse): isolate and retry.
        for (const extra of this.extras) {
          try { await extra.syncOnce(); } catch { this.extraFailed = true; }
        }
        if (this.extraFailed) {
          this.extraFailed = false;
          this.extraFailures++;
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.run(); }, Math.min(60_000, 1000 * 2 ** this.extraFailures));
        } else this.extraFailures = 0;
        this.failures = 0;
        this.set('idle');
      } while (this.again);
    } catch {
      if (!this.disposed) {
        this.failures++;
        this.set('offline');
        // Exponential backoff, capped; pending ops stay safely in the persisted outbox.
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.run(); }, Math.min(30_000, 500 * 2 ** this.failures));
      }
    } finally {
      this.running = false;
    }
  }

  private set(state: SyncClient['state']) { if (!this.disposed) { this.state = state; this.onState(state, this.store.pendingOps().length + this.extras.reduce((n, extra) => n + extra.pendingCount(), 0)); } }
  dispose() {
    this.disposed = true;
    for (const off of this.unsubscribers) off();
    if (this.kickTimer) clearTimeout(this.kickTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.kickTimer = this.retryTimer = null;
  }
}
