/** A fixed-size sample window: statistics stay exact for the last `cap` observations, and the totals never reset. */
export class Histogram {
  private samples: number[] = [];
  private next = 0;
  n = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  last = 0;
  lastAt = 0;

  constructor(private readonly cap = 256) {}

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.samples.length < this.cap) this.samples.push(value); else { this.samples[this.next] = value; this.next = (this.next + 1) % this.cap; }
    this.n++; this.sum += value; this.last = value; this.lastAt = Date.now();
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
  }

  private percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const rank = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
  }

  stats() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      n: this.n, mean: this.n ? round(this.sum / this.n) : 0, p50: round(this.percentile(sorted, 50)), p95: round(this.percentile(sorted, 95)), p99: round(this.percentile(sorted, 99)),
      min: this.n ? round(this.min) : 0, max: this.n ? round(this.max) : 0, last: round(this.last), sum: round(this.sum), lastAt: this.lastAt,
    };
  }
}

export type HistStats = ReturnType<Histogram['stats']>;

/** Counters (monotonic), gauges (latest value) and histograms (timings, sizes), addressed by dotted name. */
export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, { v: number; at: number }>();
  private hists = new Map<string, Histogram>();
  readonly since = Date.now();

  inc(name: string, by = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + by); }
  set(name: string, value: number): void { if (Number.isFinite(value)) this.gauges.set(name, { v: value, at: Date.now() }); }
  observe(name: string, value: number): void {
    let h = this.hists.get(name);
    if (!h) { h = new Histogram(); this.hists.set(name, h); }
    h.add(value);
  }

  counter(name: string): number { return this.counters.get(name) ?? 0; }
  gauge(name: string): number | null { return this.gauges.get(name)?.v ?? null; }
  hist(name: string): HistStats | null { return this.hists.get(name)?.stats() ?? null; }

  /** Time something and record it (also when it throws; the error is rethrown). */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try { return await fn(); } finally { this.observe(name, performance.now() - t0); }
  }

  /** `const done = metrics.start('x'); … done()` returns the elapsed ms. */
  start(name: string): () => number {
    const t0 = performance.now();
    return () => { const ms = performance.now() - t0; this.observe(name, ms); return ms; };
  }

  snapshot() {
    return {
      since: this.since,
      counters: Object.fromEntries([...this.counters].sort(([a], [b]) => (a < b ? -1 : 1))),
      gauges: Object.fromEntries([...this.gauges].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, g]) => [k, g.v])),
      histograms: Object.fromEntries([...this.hists].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, h]) => [k, h.stats()])),
    };
  }

  /** Names with a prefix, e.g. `net.` — the panel groups tables this way. */
  histograms(prefix: string): [string, HistStats][] {
    return [...this.hists].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, h]) => [k, h.stats()]);
  }
  counters_(prefix: string): [string, number][] { return [...this.counters].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)); }

  reset(): void { this.counters.clear(); this.gauges.clear(); this.hists.clear(); }
}
