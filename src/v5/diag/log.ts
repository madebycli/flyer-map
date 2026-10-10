import { redactText, redactValue } from './redact.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';
export const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
export type Category = 'boot' | 'engine' | 'pack' | 'net' | 'sync' | 'store' | 'notes' | 'map' | 'cache' | 'ui' | 'device' | 'error' | 'console';
export const CATEGORIES: Category[] = ['boot', 'engine', 'pack', 'net', 'sync', 'store', 'notes', 'map', 'cache', 'ui', 'device', 'error', 'console'];
export type Entry = { seq: number; /** ms since the page started (monotonic) */ t: number; /** wall clock */ at: number; lvl: Level; cat: Category; msg: string; data?: unknown; prev?: true };

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const mono = () => (typeof performance !== 'undefined' ? Math.round(performance.now() * 10) / 10 : 0);

/**
 * Two bounded rings: everything recent, and warnings/errors on their own so a burst of debug lines can never push the one
 * error that matters out of the log. Memory is fixed; a log call without listeners costs one object and one redaction pass.
 */
export class Logger {
  private ring: Entry[] = [];
  private sticky: Entry[] = [];
  private seq = 0;
  private listeners = new Set<() => void>();
  private notify: ReturnType<typeof setTimeout> | null = null;
  /** debug lines are dropped unless verbose (`?diag=1`, or switched on in the panel). */
  verbose = false;
  readonly counts: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  /** Called for warn/error entries (persistence of the tail across reloads). */
  onSticky: ((entries: Entry[]) => void) | null = null;

  constructor(private readonly cap = 1000, private readonly stickyCap = 300) {}

  log(lvl: Level, cat: Category, msg: string, data?: unknown): void {
    if (lvl === 'debug' && !this.verbose) return;
    this.counts[lvl]++;
    const entry: Entry = { seq: ++this.seq, t: mono(), at: Date.now(), lvl, cat, msg: redactText(msg, 200) };
    if (data !== undefined) entry.data = redactValue(data);
    this.ring.push(entry);
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
    if (RANK[lvl] >= RANK.warn) {
      this.sticky.push(entry);
      if (this.sticky.length > this.stickyCap) this.sticky.splice(0, this.sticky.length - this.stickyCap);
      this.onSticky?.(this.sticky);
    }
    this.schedule();
  }

  debug(cat: Category, msg: string, data?: unknown) { this.log('debug', cat, msg, data); }
  info(cat: Category, msg: string, data?: unknown) { this.log('info', cat, msg, data); }
  warn(cat: Category, msg: string, data?: unknown) { this.log('warn', cat, msg, data); }
  error(cat: Category, msg: string, data?: unknown) { this.log('error', cat, msg, data); }

  /** Newest last; both rings merged without duplicates. */
  entries(filter: { min?: Level; cat?: Category | 'all'; text?: string; limit?: number } = {}): Entry[] {
    const seen = new Set<number>();
    const merged: Entry[] = [];
    for (const entry of [...this.sticky, ...this.ring]) if (!seen.has(entry.seq)) { seen.add(entry.seq); merged.push(entry); }
    merged.sort((a, b) => a.seq - b.seq);
    const min = RANK[filter.min ?? 'debug'];
    const needle = filter.text?.trim().toLowerCase();
    const picked = merged.filter((e) => RANK[e.lvl] >= min && (!filter.cat || filter.cat === 'all' || e.cat === filter.cat)
      && (!needle || e.msg.toLowerCase().includes(needle) || (e.data !== undefined && JSON.stringify(e.data).toLowerCase().includes(needle))));
    return filter.limit ? picked.slice(-filter.limit) : picked;
  }

  clear(): void {
    this.ring = []; this.sticky = [];
    for (const level of LEVELS) this.counts[level] = 0;
    this.schedule();
  }

  /** Listeners are told at most once per task, so a burst of entries re-renders a panel once. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private schedule() {
    if (this.notify || !this.listeners.size) return;
    this.notify = setTimeout(() => { this.notify = null; for (const listener of this.listeners) listener(); }, 0);
  }
}
