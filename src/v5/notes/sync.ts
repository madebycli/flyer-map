import type { NoteStore } from './store.ts';
import type { Note } from './types.ts';
import { diag } from '../diag/index.ts';

export interface NoteTransport {
  pull(since: number): Promise<{ notes: Note[]; cursor: number; more?: boolean; serverNow?: number }>;
  push(notes: Note[]): Promise<{ accepted: string[]; rejected?: { id: string; reason: string }[] }>;
}

/** One push-then-pull round for notes; the status SyncClient drives it, so both share kicks, backoff and the online indicator. */
export class NoteSync {
  constructor(private readonly store: NoteStore, private readonly transport: NoteTransport, private readonly batch = 50) {}

  subscribe(listener: () => void): () => void { return this.store.subscribe(listener); }

  pendingCount(): number { return this.store.pendingNotes().length; }

  async syncOnce(): Promise<void> {
    for (let sent = this.store.pendingNotes(); sent.length; sent = this.store.pendingNotes()) {
      const batch = sent.slice(0, this.batch);
      const result = await this.transport.push(batch);
      diag.inc('notes.push.batches'); diag.inc('notes.push.sent', batch.length); diag.inc('notes.push.accepted', result.accepted.length);
      if (result.rejected?.length) { diag.inc('notes.push.rejected', result.rejected.length); diag.warn('notes', 'notes refused by the server', { count: result.rejected.length, reasons: [...new Set(result.rejected.map((r) => String(r.reason).replace(/[^a-z_-]/gi, '').slice(0, 40)))] }); }
      const accepted = new Set(result.accepted);
      const refused = new Set((result.rejected ?? []).map((r) => r.id));
      this.store.acknowledge(batch.filter((n) => accepted.has(n.id)));
      this.store.rollback(batch.filter((n) => refused.has(n.id)));
      if (!batch.some((n) => accepted.has(n.id) || refused.has(n.id))) break;
    }
    for (;;) {
      const page = await this.transport.pull(this.store.lastCursor);
      diag.inc('notes.pull.pages'); diag.inc('notes.pull.notes', page.notes.length);
      if (page.serverNow !== undefined) this.store.syncClock(page.serverNow);
      this.store.receive(page.notes, page.cursor);
      if (!page.more || !page.notes.length) break;
    }
  }
}
