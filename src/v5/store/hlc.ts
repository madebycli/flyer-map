/**
 * Hybrid logical clock. Timestamps are fixed-width strings, so plain string comparison
 * is a total order that survives device clock skew (never goes backwards) and ties
 * are broken deterministically by the node id.
 */
export type ClockState = { wall: number; counter: number; node: string };

const W = 11, C = 4;
export const encodeClock = (c: ClockState) => `${c.wall.toString(36).padStart(W, '0')}-${c.counter.toString(36).padStart(C, '0')}-${c.node}`;

export function decodeClock(text: string): ClockState | null {
  const m = /^([0-9a-z]{11})-([0-9a-z]{4})-(.+)$/.exec(text);
  return m ? { wall: parseInt(m[1], 36), counter: parseInt(m[2], 36), node: m[3] } : null;
}

export function tick(state: ClockState, now: number): ClockState {
  const wall = Math.max(state.wall, now);
  return { node: state.node, wall, counter: wall === state.wall ? state.counter + 1 : 0 };
}

/** Merge a remote timestamp so that every later local tick sorts after it. */
export function receive(state: ClockState, remote: string, now: number): ClockState {
  const r = decodeClock(remote);
  if (!r) return state;
  const wall = Math.max(state.wall, r.wall, now);
  let counter = 0;
  if (wall === state.wall && wall === r.wall) counter = Math.max(state.counter, r.counter) + 1;
  else if (wall === state.wall) counter = state.counter + 1;
  else if (wall === r.wall) counter = r.counter + 1;
  return { node: state.node, wall, counter };
}
