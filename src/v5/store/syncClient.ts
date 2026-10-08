import type { FieldStore } from './store.ts';
import type { Op } from './types.ts';

export interface SyncTransport {
  pull(since: number): Promise<{ ops: Op[]; cursor: number }>;
  push(ops: Op[]): Promise<{ accepted: string[]; cursor: number }>;
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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  state: 'idle' | 'syncing' | 'offline' = 'idle';

  constructor(
    private readonly store: FieldStore,
    private readonly transport: SyncTransport,
    private readonly batchSize = 200,
    private readonly onState: (state: SyncClient['state'], pending: number) => void = () => {},
  ) {
    this.unsubscribe = store.subscribe(() => this.kick());
  }

  kick(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, 50);
  }

  async run(): Promise<void> {
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
          if (!result.accepted.length) break;
        }
        for (;;) {
          const { ops, cursor } = await this.transport.pull(this.store.lastCursor);
          this.store.receive(ops, cursor);
          if (!ops.length || cursor <= 0) break;
        }
        this.failures = 0;
        this.set('idle');
      } while (this.again);
    } catch {
      this.failures++;
      this.set('offline');
      // Exponential backoff, capped; pending ops stay safely in the persisted outbox.
      this.timer = setTimeout(() => { this.timer = null; void this.run(); }, Math.min(30_000, 500 * 2 ** this.failures));
    } finally {
      this.running = false;
    }
  }

  private set(state: SyncClient['state']) { this.state = state; this.onState(state, this.store.pendingOps().length); }
  dispose() { this.unsubscribe(); if (this.timer) clearTimeout(this.timer); }
}
