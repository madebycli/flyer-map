import type { FieldStore } from '../store/store.ts';
import type { EntityKey, Status } from '../store/types.ts';

/** The codes the engine knows (`Session::set_status` in engine-rs): 0 open, 1 completed, 2 later, 3 not-deliverable. */
export const STATUS_CODE: Record<Status, number> = { open: 0, completed: 1, later: 2, 'not-deliverable': 3 };

/** What `bind` needs to know when the engine cut the statuses into its tiles: the statuses it was given, and where to send later changes. */
export type BakedStatus = { baseline: Map<EntityKey, Status>; send: (entries: [EntityKey, Status][]) => void };
/** Hand the engine the statuses of the store (before the tiles are asked for); null when the engine cannot (the map then paints everything itself). */
export async function bakeStatuses(store: FieldStore, engine: { setStatus(entries: [string, number][]): Promise<void> }): Promise<BakedStatus | null> {
  const baseline = new Map<EntityKey, Status>();
  for (const [key, entry] of store.entries()) if (entry.status !== 'open') baseline.set(key, entry.status);
  try { await engine.setStatus([...baseline].map(([key, status]) => [key, STATUS_CODE[status]])); } catch { return null; }
  return { baseline, send: (entries) => { void engine.setStatus(entries.map(([key, status]) => [key, STATUS_CODE[status]])).catch(() => {}); } };
}
