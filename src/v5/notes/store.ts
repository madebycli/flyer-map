import { type ClockState, encodeClock, receive, tick } from './../store/hlc.ts';
import { type Flag, type Note, type NoteKey, type NotePersistence, cleanText } from './types.ts';

type Listener = (keys: ReadonlySet<NoteKey>) => void;

/**
 * Notes with last-writer-wins per note id. Same guarantees as the status overlay: edits are applied locally at once,
 * queued in a persisted outbox, idempotent on the server, and a remote revision never silently replaces a newer local one.
 */
export class NoteStore {
  private notes = new Map<string, Note>();
  /** What the server last confirmed per note: the state to fall back to when an edit is refused for good. */
  private confirmed = new Map<string, Note>();
  private pending = new Map<string, Note>();
  private byKey = new Map<NoteKey, Set<string>>();
  private clock: ClockState;
  private cursor = 0;
  private listeners = new Set<Listener>();
  private touched = new Set<NoteKey>();
  /** Bumps whenever any note changes; the cheap snapshot React needs. */
  version = 0;
  private flushScheduled = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private mayPersist: boolean;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly actor: string,
    private readonly persistence: NotePersistence | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.clock = { wall: 0, counter: 0, node: actor };
    this.mayPersist = persistence === null;
  }

  async hydrate(): Promise<void> {
    const saved = await this.persistence?.load();
    this.mayPersist = true;
    if (!saved || saved.version !== 1) return;
    this.clock = { ...saved.clock, node: this.actor };
    this.cursor = saved.cursor;
    for (const note of saved.notes) { this.confirmed.set(note.id, note); this.apply(note); }
    for (const note of saved.pending) { this.pending.set(note.id, note); this.apply(note); }
    this.flush();
  }

  get lastCursor() { return this.cursor; }
  pendingNotes(): Note[] { return [...this.pending.values()].sort((a, b) => (a.rev < b.rev ? -1 : 1)); }

  forKey(key: NoteKey): Note[] {
    return [...(this.byKey.get(key) ?? [])].map((id) => this.notes.get(id)!).filter((n) => !n.deleted).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  /** Every live note, oldest first. */
  all(): Note[] { return [...this.notes.values()].filter((n) => !n.deleted).sort((a, b) => (a.id < b.id ? -1 : 1)); }
  get(id: string): Note | undefined { return this.notes.get(id); }

  add(key: NoteKey, area: string, flag: Flag | null, text: string): Note | null {
    const clean = cleanText(text);
    if (!flag && clean === '') return null;
    const id = this.stamp();
    const note: Note = { id, key, area, flag, text: clean, rev: id, deleted: false, by: this.actor };
    return this.commit(note);
  }

  edit(id: string, patch: { flag?: Flag | null; text?: string }): Note | null {
    const current = this.notes.get(id);
    if (!current || current.deleted) return null;
    const flag = patch.flag === undefined ? current.flag : patch.flag;
    const text = patch.text === undefined ? current.text : cleanText(patch.text);
    if (flag === current.flag && text === current.text) return current;
    if (!flag && text === '') return this.remove(id);
    return this.commit({ ...current, flag, text, rev: this.stamp() });
  }

  remove(id: string): Note | null {
    const current = this.notes.get(id);
    if (!current || current.deleted) return null;
    return this.commit({ ...current, deleted: true, rev: this.stamp() });
  }

  /** Undo of a removal. */
  restore(id: string): Note | null {
    const current = this.notes.get(id);
    if (!current || !current.deleted) return null;
    return this.commit({ ...current, deleted: false, rev: this.stamp() });
  }

  /** Server rows (and our own, echoed back). */
  receive(rows: Note[], cursor?: number): void {
    for (const row of rows) {
      this.clock = receive(this.clock, row.rev, this.now());
      const known = this.confirmed.get(row.id);
      if (!known || known.rev < row.rev) this.confirmed.set(row.id, row);
      const pending = this.pending.get(row.id);
      if (pending && pending.rev <= row.rev) this.pending.delete(row.id); // echoed or superseded
      const local = this.notes.get(row.id);
      if (!local || local.rev < row.rev) this.apply(row);
    }
    if (cursor !== undefined && cursor > this.cursor) this.cursor = cursor;
    this.flush();
    this.scheduleSave();
  }

  /** The server stored exactly these revisions. */
  acknowledge(sent: Note[]): void {
    for (const note of sent) {
      if (this.pending.get(note.id)?.rev === note.rev) this.pending.delete(note.id);
      const known = this.confirmed.get(note.id);
      if (!known || known.rev < note.rev) this.confirmed.set(note.id, note);
    }
    this.persistOutbox();
    this.scheduleSave();
  }

  /** Refused for good: show what the server really has. */
  rollback(refused: Note[]): void {
    for (const note of refused) {
      if (this.pending.get(note.id)?.rev !== note.rev) continue; // a newer edit supersedes it
      this.pending.delete(note.id);
      const back = this.confirmed.get(note.id);
      if (back) this.apply(back, true);
      else this.drop(note.id);
    }
    this.flush();
    this.persistOutbox();
    this.scheduleSave();
  }

  /** Server time seen on a pull: a phone that is an hour off must not lose every edit race or have its notes refused. */
  syncClock(serverNow: number) {
    const offset = serverNow - this.now();
    if (Number.isFinite(offset)) this.clockOffset = offset;
  }
  private clockOffset = 0;

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private stamp(): string {
    this.clock = tick(this.clock, this.now() + this.clockOffset);
    return encodeClock(this.clock);
  }

  private commit(note: Note): Note {
    this.apply(note, true);
    this.pending.set(note.id, note);
    this.flush();
    this.persistOutbox();
    this.scheduleSave();
    return note;
  }

  private apply(note: Note, force = false) {
    const existing = this.notes.get(note.id);
    if (!force && existing && existing.rev >= note.rev) return;
    this.notes.set(note.id, note);
    let ids = this.byKey.get(note.key);
    if (!ids) this.byKey.set(note.key, (ids = new Set()));
    ids.add(note.id);
    this.touched.add(note.key);
  }

  private drop(id: string) {
    const note = this.notes.get(id);
    if (!note) return;
    this.notes.delete(id);
    this.byKey.get(note.key)?.delete(id);
    this.touched.add(note.key);
  }

  private flush() {
    if (this.flushScheduled || !this.touched.size) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const keys = this.touched;
      this.touched = new Set();
      this.version++;
      for (const listener of this.listeners) listener(keys);
    });
  }

  private scheduleSave() {
    if (!this.persistence || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.persistNow(); }, 400);
  }

  persistOutbox(): Promise<void> { return this.persistNow(); }
  async persistNow(): Promise<void> {
    if (!this.persistence || !this.mayPersist) return;
    const data = { version: 1 as const, clock: { ...this.clock }, cursor: this.cursor, notes: [...this.confirmed.values()], pending: this.pendingNotes() };
    await (this.chain = this.chain.then(() => this.persistence!.save(data)).catch(() => {}));
  }
}

export class MemoryNotePersistence implements NotePersistence {
  data: Awaited<ReturnType<NotePersistence['load']>> = null;
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(data: NonNullable<Awaited<ReturnType<NotePersistence['load']>>>) { this.data = structuredClone(data); }
}
