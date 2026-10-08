import type { Network } from '../engine/types.ts';
import type { FieldStore } from './store.ts';
import { type Status, STATUSES } from './types.ts';

export type ProgressSnapshot = {
  houses: Record<Status, number>;
  /** Metres of visible street per status. */
  streetMeters: Record<Status, number>;
  totalHouses: number;
  totalStreetMeters: number;
  /** completed / (all − not-deliverable) in [0,1]. */
  houseRatio: number;
};

const zero = (): Record<Status, number> => ({ open: 0, completed: 0, later: 0, 'not-deliverable': 0 });

/** O(changes) progress counters; recomputing from scratch is never needed after construction. */
export class Progress {
  private houses = zero();
  private meters = zero();
  private houseKeys = new Set<string>();
  private meterOf = new Map<string, number>();
  private listeners = new Set<(s: ProgressSnapshot) => void>();
  private off: () => void;

  constructor(network: Network, private readonly store: FieldStore) {
    for (const house of network.houses) this.houseKeys.add(`h:${house.id}`);
    for (const segment of network.segments) if (segment.visible) this.meterOf.set(`s:${segment.id}`, segment.length);
    this.houses.open = this.houseKeys.size;
    for (const length of this.meterOf.values()) this.meters.open += length;
    for (const [key, entry] of store.entries()) this.move(key, 'open', entry.status);
    this.off = store.subscribe((changes) => {
      for (const [key, status] of changes) this.move(key, this.last.get(key) ?? 'open', status);
      this.emit();
    });
  }

  private last = new Map<string, Status>();

  private move(key: string, from: Status, to: Status) {
    if (from === to) return;
    if (this.houseKeys.has(key)) { this.houses[from]--; this.houses[to]++; }
    else {
      const length = this.meterOf.get(key);
      if (length === undefined) return;
      this.meters[from] -= length; this.meters[to] += length;
    }
    this.last.set(key, to);
  }

  snapshot(): ProgressSnapshot {
    const total = STATUSES.reduce((s, k) => s + this.houses[k], 0);
    const deliverable = total - this.houses['not-deliverable'];
    return {
      houses: { ...this.houses }, streetMeters: { ...this.meters }, totalHouses: total,
      totalStreetMeters: STATUSES.reduce((s, k) => s + this.meters[k], 0),
      houseRatio: deliverable > 0 ? this.houses.completed / deliverable : 0,
    };
  }

  onChange(listener: (s: ProgressSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit() { const s = this.snapshot(); for (const l of this.listeners) l(s); }
  dispose() { this.off(); this.listeners.clear(); }
}
