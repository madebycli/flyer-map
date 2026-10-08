import { type ClockState, encodeClock, receive, tick } from './hlc.ts';
import type { EntityKey, Op, OverlayEntry, Persisted, Persistence, Status } from './types.ts';

export type Changes = ReadonlyMap<EntityKey, Status>;
type Listener = (changes: Changes) => void;

/**
 * Status overlay with last-writer-wins per key. All mutations are commutative and
 * idempotent, so clients converge regardless of delivery order or duplicates.
 * Listeners get *only the keys that changed*, coalesced per microtask: the map
 * paints exactly those features, React re-renders only affected selectors.
 */
export class FieldStore {
  private overlay = new Map<EntityKey, OverlayEntry>();
  private pending = new Map<string, Op>();
  private clock: ClockState;
  private cursor = 0;
  private listeners = new Set<Listener>();
  private keyListeners = new Map<EntityKey, Set<() => void>>();
  /** Status each touched key had at the last flush, so no-op round trips emit nothing. */
  private baseline = new Map<EntityKey, Status>();
  private flushScheduled = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private areaOf: ((key: EntityKey) => string | undefined) | null = null;
  /** Saving before the persisted state was loaded would overwrite the offline outbox with an empty one. */
  private mayPersist: boolean;

  constructor(
    readonly actor: string,
    private readonly persistence: Persistence | null = null,
    private readonly now: () => number = Date.now,
    private readonly saveDelayMs = 400,
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
    for (const [key, entry] of saved.overlay) this.applyEntry(key, entry);
    for (const op of saved.pending) {
      this.pending.set(op.id, op);
      this.applyEntry(op.key, { status: op.status, at: op.id, by: op.by }); // edits survive even if the overlay record is older
    }
    this.flush();
  }

  /** Stamps outgoing edits with their Area (needed for server-side team scoping). */
  setAreaResolver(resolver: (key: EntityKey) => string | undefined) { this.areaOf = resolver; }

  statusOf(key: EntityKey): Status { return this.overlay.get(key)?.status ?? 'open'; }
  get size() { return this.overlay.size; }
  get lastCursor() { return this.cursor; }
  entries(): IterableIterator<[EntityKey, OverlayEntry]> { return this.overlay.entries(); }
  pendingOps(): Op[] { return [...this.pending.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); }

  /** Local edit. Returns the operations so a caller can undo them. */
  set(keys: EntityKey | EntityKey[], status: Status): Op[] {
    const ops: Op[] = [];
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.statusOf(key) === status && this.overlay.has(key)) continue;
      this.clock = tick(this.clock, this.now());
      const area = this.areaOf?.(key);
      const op: Op = { id: encodeClock(this.clock), key, status, by: this.actor, ...(area ? { area } : {}) };
      this.applyEntry(key, { status, at: op.id, by: op.by });
      this.pending.set(op.id, op);
      ops.push(op);
    }
    this.flush();
    if (ops.length) this.persistOutbox();
    this.scheduleSave();
    return ops;
  }

  /** Remote operations (and our own, echoed back). `cursor` advances the server position. */
  receive(ops: Op[], cursor?: number): void {
    for (const op of ops) {
      this.clock = receive(this.clock, op.id, this.now());
      this.applyEntry(op.key, { status: op.status, at: op.id, by: op.by });
      this.pending.delete(op.id);
    }
    if (cursor !== undefined && cursor > this.cursor) this.cursor = cursor;
    this.flush();
    this.scheduleSave();
  }

  /**
   * The server refused these edits for good (forbidden area, foreign key, impossible clock). Undo their local
   * effect so the screen shows what the server actually has, instead of a status nobody else will ever see.
   */
  rollback(ids: string[]): void {
    for (const id of ids) {
      const op = this.pending.get(id);
      if (!op) continue;
      this.pending.delete(id);
      const entry = this.overlay.get(op.key);
      if (entry?.at !== id) continue; // a newer local edit supersedes it and is judged on its own
      if (!this.baseline.has(op.key)) this.baseline.set(op.key, entry.status);
      this.overlay.delete(op.key);
    }
    this.flush();
    this.persistOutbox();
    this.scheduleSave();
  }

  /** Server confirmed these operations; they leave the outbox. */
  acknowledge(ids: string[]): void {
    for (const id of ids) this.pending.delete(id);
    this.persistOutbox();
    this.scheduleSave();
  }

  /**
   * After the derived network is known: stamp queued edits with their Area and drop edits whose
   * entity no longer exists (e.g. an Area was removed), which could otherwise never be sent.
   */
  reconcilePending(isKnownKey: (key: EntityKey) => boolean): number {
    let dropped = 0;
    for (const [id, op] of this.pending) {
      if (!isKnownKey(op.key)) { this.pending.delete(id); dropped++; continue; }
      if (!op.area) { const area = this.areaOf?.(op.key); if (area) this.pending.set(id, { ...op, area }); }
    }
    if (dropped) this.scheduleSave();
    return dropped;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Shape for useSyncExternalStore: re-renders only when this key changes. */
  subscribeKey(key: EntityKey, listener: () => void): () => void {
    let set = this.keyListeners.get(key);
    if (!set) this.keyListeners.set(key, (set = new Set()));
    set.add(listener);
    return () => { set!.delete(listener); if (!set!.size) this.keyListeners.delete(key); };
  }

  private applyEntry(key: EntityKey, entry: OverlayEntry) {
    const existing = this.overlay.get(key);
    if (existing && existing.at >= entry.at) return;
    if (!this.baseline.has(key)) this.baseline.set(key, existing?.status ?? 'open');
    this.overlay.set(key, entry);
  }

  private flush() {
    if (this.flushScheduled || !this.baseline.size) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const touched = this.baseline;
      this.baseline = new Map();
      const changes = new Map<EntityKey, Status>();
      for (const [key, before] of touched) {
        const now = this.statusOf(key);
        if (now !== before) changes.set(key, now);
      }
      if (!changes.size) return;
      for (const listener of this.listeners) listener(changes);
      for (const key of changes.keys()) for (const l of this.keyListeners.get(key) ?? []) l();
    });
  }

  private scheduleSave() {
    if (!this.persistence || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.persistNow(); }, this.saveDelayMs);
  }

  private chain: Promise<void> = Promise.resolve();
  private snapshot(withOverlay: boolean): Persisted {
    return { version: 1, clock: { ...this.clock }, cursor: this.cursor, overlay: withOverlay ? [...this.overlay.entries()] : [], pending: this.pendingOps() };
  }

  /** Queued edits are written right away (cheap, serialised): they are what an app kill must not lose. */
  persistOutbox(): Promise<void> {
    if (!this.persistence || !this.mayPersist) return this.chain;
    const data = this.snapshot(false);
    return (this.chain = this.chain.then(() => this.persistence!.save(data, 'outbox')).catch(() => {}));
  }

  async persistNow(): Promise<void> {
    if (!this.persistence || !this.mayPersist) return;
    const data = this.snapshot(true);
    await (this.chain = this.chain.then(() => this.persistence!.save(data, 'all')).catch(() => {}));
  }
}

export class MemoryPersistence implements Persistence {
  data: Persisted | null = null;
  saves: ('all' | 'outbox')[] = [];
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(data: Persisted, scope: 'all' | 'outbox') {
    this.saves.push(scope);
    const copy = structuredClone(data);
    // Mirror the split storage: an outbox-only save keeps the previously saved overlay.
    this.data = scope === 'all' || !this.data ? copy : { ...copy, overlay: this.data.overlay };
  }
}
