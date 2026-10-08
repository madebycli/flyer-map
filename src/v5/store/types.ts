export type Status = 'open' | 'completed' | 'later' | 'not-deliverable';
export const STATUSES: readonly Status[] = ['open', 'completed', 'later', 'not-deliverable'];

/** `s:<segmentId>` or `h:<houseId>`: the stable derived-entity key. */
export type EntityKey = string;

export type Op = {
  /** Globally unique: the encoded HLC timestamp. */
  id: string;
  key: EntityKey;
  status: Status;
  by: string;
  /** Area the edit was made in; the server enforces team scope with it. */
  area?: string;
};

export type OverlayEntry = { status: Status; at: string; by: string };

export type Persisted = {
  version: 1;
  clock: { wall: number; counter: number; node: string };
  overlay: [EntityKey, OverlayEntry][];
  pending: Op[];
  cursor: number;
};

/**
 * `scope: 'outbox'` writes only the small, critical part (clock, cursor, queued edits) and is called on every local
 * edit; `'all'` also writes the potentially large overlay and is debounced.
 */
export interface Persistence {
  load(): Promise<Persisted | null>;
  save(data: Persisted, scope: 'all' | 'outbox'): Promise<void>;
}

export const isStatus = (value: unknown): value is Status => typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
export const segmentKey = (id: string): EntityKey => `s:${id}`;
export const houseKey = (id: string): EntityKey => `h:${id}`;
