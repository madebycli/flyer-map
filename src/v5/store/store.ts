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

  constructor(
    readonly actor: string,
    private readonly persistence: Persistence | null = null,
    private readonly now: () => number = Date.now,
    private readonly saveDelayMs = 400,
  ) {
    this.clock = { wall: 0, counter: 0, node: actor };
  }

  async hydrate(): Promise<void> {
    const saved = await this.persistence?.load();
    if (!saved || saved.version !== 1) return;
    this.clock = { ...saved.clock, node: this.actor };
    this.cursor = saved.cursor;
    for (const [key, entry] of saved.overlay) this.applyEntry(key, entry);
    for (const op of saved.pending) this.pending.set(op.id, op);
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

  /** Server confirmed these operations; they leave the outbox. */
  acknowledge(ids: string[]): void {
    for (const id of ids) this.pending.delete(id);
    this.scheduleSave();
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

  async persistNow(): Promise<void> {
    if (!this.persistence) return;
    const data: Persisted = {
      version: 1, clock: this.clock, cursor: this.cursor,
      overlay: [...this.overlay.entries()], pending: this.pendingOps(),
    };
    await this.persistence.save(data);
  }
}

export class MemoryPersistence implements Persistence {
  data: Persisted | null = null;
  async load() { return this.data ? structuredClone(this.data) : null; }
  async save(data: Persisted) { this.data = structuredClone(data); }
}
