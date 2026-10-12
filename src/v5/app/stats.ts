import type { FieldNetwork as Network } from '../engine/types.ts';
import { STATUSES, type EntityKey, type Status } from '../store/types.ts';

export type Tally = Record<Status, number>;
export const emptyTally = (): Tally => ({ open: 0, completed: 0, later: 0, 'not-deliverable': 0 });
export const tallyTotal = (t: Tally) => STATUSES.reduce((sum, s) => sum + t[s], 0);

/**
 * Progress is counted in houses: finished / (all − not possible). A street is a way to reach houses, not a unit of work, so a
 * long empty road never skews the number. Nothing to deliver at all reads as 0 %, not as a division by zero.
 */
export function percentOf(t: Tally): number {
  const deliverable = tallyTotal(t) - t['not-deliverable'];
  return deliverable > 0 ? Math.round((t.completed / deliverable) * 100) : 0;
}

export type HouseStats = { overall: Tally; byArea: Map<string, Tally> };

/** One pass over the houses; call it when an overview is opened or the progress changed, never per frame. */
export function houseStats(network: Network, statusOf: (key: EntityKey) => Status, areaOf: ReadonlyMap<string, string>): HouseStats {
  const overall = emptyTally(), byArea = new Map<string, Tally>();
  for (const house of network.houses) {
    const key = `h:${house.id}`, status = statusOf(key);
    overall[status]++;
    const area = areaOf.get(key);
    if (!area) continue;
    let t = byArea.get(area);
    if (!t) { t = emptyTally(); byArea.set(area, t); }
    t[status]++;
  }
  return { overall, byArea };
}

/** "vor 12 s", "vor 3 min", "vor 2 h": short and without a clock the person would have to compare. */
export function ago(then: number | null, now: number): string {
  if (then === null) return 'noch nie';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return `vor ${Math.round(s / 86400)} d`;
}

export type ServerAreaProgress = { houses: number; units: number; completed: number; later: number; notDeliverable: number };

/**
 * While not every part of a Gebiet is on the device yet, the numbers of that Gebiet come from the server (size reported by the devices, done counts
 * counted in the database) instead of the houses loaded so far. Only used when the server knows all `expectedUnits` of the Gebiet.
 */
export function withServerProgress(local: HouseStats, server: Record<string, ServerAreaProgress> | null, partial: ReadonlySet<string>, expectedUnits: ReadonlyMap<string, number>): HouseStats {
  if (!server || !partial.size) return local;
  const byArea = new Map(local.byArea), overall = { ...local.overall };
  for (const area of partial) {
    const s = server[area];
    if (!s || s.units < (expectedUnits.get(area) ?? Infinity)) continue;
    const before = byArea.get(area) ?? emptyTally();
    const after: Tally = { completed: s.completed, later: s.later, 'not-deliverable': s.notDeliverable, open: Math.max(0, s.houses - s.completed - s.later - s.notDeliverable) };
    for (const status of STATUSES) overall[status] += after[status] - before[status];
    byArea.set(area, after);
  }
  return { overall, byArea };
}
