/**
 * Golden vectors for `flyermap-core`: random but seeded scenarios run through the TypeScript FieldStore (the oracle), recording after every step
 * everything observable. The Rust tests replay the same steps and must produce the same state.
 *   node --experimental-transform-types scripts/rs-vectors/store.ts            writes the vector file
 *   node --experimental-transform-types scripts/rs-vectors/store.ts --check    fails when the committed file is out of date
 *   node --experimental-transform-types scripts/rs-vectors/store.ts --seeds 2000 --length 200 --out /tmp/big.json    a long fuzz run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { FieldStore, MemoryPersistence } from '../../src/v5/store/store.ts';
import { encodeClock } from '../../src/v5/store/hlc.ts';
import type { EntityKey, Op, Status } from '../../src/v5/store/types.ts';

const FILE = new URL('../../flyermap-rs/crates/flyermap-core/tests/vectors/store.json', import.meta.url);
const STATUSES: Status[] = ['open', 'completed', 'later', 'not-deliverable'];
const KEYS: EntityKey[] = ['s:1', 's:2', 's:3', 's:4', 'h:1', 'h:2', 'h:3', 'h:4', 'h:5', 'h:6'];

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Step = Record<string, unknown> & { cmd: string };

async function scenario(seed: number, length: number) {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const some = <T,>(list: readonly T[], max: number) => { const n = int(1, Math.min(max, list.length)); const copy = [...list]; const out: T[] = []; while (out.length < n) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]); return out; };
  const actor = pick(['alice', 'bob']);
  let now = 1_700_000_000_000 + int(0, 1000);
  const persistence = new MemoryPersistence();
  const store = new FieldStore(actor, persistence, () => now, 1e9);
  await store.hydrate();
  let changes: Record<string, string> = {};
  store.subscribe((c) => { for (const [k, s] of c) changes[k] = s; });
  const areaFor = (key: string) => (key === 'h:6' ? undefined : parseInt(key.slice(-1), 10) % 2 ? 'a1' : 'a2');

  const observe = () => ({
    overlay: [...store.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, e]) => [k, e.status, e.at, e.by]),
    pending: store.pendingOps(),
    cursor: store.lastCursor,
    conflicts: store.pendingConflicts.map((c) => ({ ...c })),
    clockOffset: store.describe().clockOffsetMs,
  });
  const steps: unknown[] = [];
  for (let i = 0; i < length; i++) {
    now += int(0, 3000) - (r() < 0.1 ? 4000 : 0); // the device clock sometimes jumps back
    now = Math.max(now, 1_600_000_000_000);
    const roll = r();
    let step: Step;
    let result: unknown = null;
    if (roll < 0.34) {
      const keys = some(KEYS, 3); const status = pick(STATUSES);
      const areas: Record<string, string | null> = Object.fromEntries(keys.map((k) => [k, areaFor(k) ?? null]));
      step = { cmd: 'set', now, keys, status, areas };
      store.setAreaResolver((k) => areas[k] ?? undefined);
      result = store.set(keys, status);
    } else if (roll < 0.62) {
      const ops: Op[] = [];
      for (let n = int(1, 4); n > 0; n--) {
        const mine = store.pendingOps();
        if (mine.length && r() < 0.3) { ops.push(pick(mine)); continue; } // our own edit coming back
        const wall = now + int(-5000, 5000), counter = int(0, 5), node = pick(['b', 'c']);
        const id = r() < 0.05 ? 'junk-id' : encodeClock({ wall, counter, node });
        ops.push({ id, key: pick(KEYS), status: pick(STATUSES), by: node, area: areaFor(pick(KEYS)) ?? undefined });
      }
      const cursor = r() < 0.7 ? store.lastCursor + int(0, 5) : null;
      step = { cmd: 'receive', now, ops, cursor };
      store.receive(ops, cursor ?? undefined);
    } else if (roll < 0.72) {
      const ids = store.pendingOps().map((o) => o.id);
      const chosen = ids.length ? some(ids, 3) : [];
      step = { cmd: 'acknowledge', ids: chosen };
      store.acknowledge(chosen);
    } else if (roll < 0.80) {
      const ids = store.pendingOps().map((o) => o.id);
      const chosen = [...(ids.length ? some(ids, 2) : []), ...(r() < 0.2 ? ['unknown-id'] : [])];
      step = { cmd: 'rollback', ids: chosen };
      store.rollback(chosen);
    } else if (roll < 0.85) {
      const keys = some(KEYS, 3);
      step = { cmd: 'forget', keys };
      result = store.forget(keys);
    } else if (roll < 0.89) {
      const known = some(KEYS, KEYS.length);
      const areas: Record<string, string | null> = Object.fromEntries(KEYS.map((k) => [k, areaFor(k) ?? null]));
      step = { cmd: 'reconcile', known, areas };
      store.setAreaResolver((k) => areas[k] ?? undefined);
      result = store.reconcilePending((k) => known.includes(k));
    } else if (roll < 0.93) {
      const serverNow = now + int(-3_600_000, 3_600_000);
      step = { cmd: 'sync_clock', now, serverNow };
      store.syncClock(serverNow);
    } else if (roll < 0.95) {
      step = { cmd: 'rewind' };
      store.rewindCursor();
    } else if (roll < 0.97) {
      const keys = r() < 0.5 ? null : some(KEYS, 2);
      step = { cmd: 'dismiss', keys };
      store.dismissConflicts(keys ?? undefined);
    } else {
      // Save and start again from what was saved: the queue and the overlay must come back.
      await store.persistNow();
      const saved = JSON.parse(JSON.stringify(persistence.data));
      const again = new FieldStore(actor, persistence, () => now, 1e9);
      await again.hydrate();
      step = { cmd: 'restart', saved };
      // The old store goes on; the new one is checked against the same observation by the Rust side after `restart`.
      result = { restored: { overlay: [...again.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, e]) => [k, e.status, e.at, e.by]), pending: again.pendingOps(), cursor: again.lastCursor } };
    }
    await Promise.resolve();
    const seen = changes; changes = {};
    steps.push({ ...step, result, after: observe(), changes: Object.entries(seen).sort((a, b) => (a[0] < b[0] ? -1 : 1)) });
  }
  return { seed, actor, steps };
}

// The committed file is small (the check must stay cheap); `--seeds N --out FILE` makes a big one for a long fuzz run (VECTORS_FILE=FILE cargo test).
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const seeds = Number(arg('--seeds') ?? 20), length = Number(arg('--length') ?? 50);
const scenarios = [];
for (let seed = 1; seed <= seeds; seed++) scenarios.push(await scenario(seed, length));
const text = `${JSON.stringify({ about: 'made by scripts/rs-vectors/store.ts from the TypeScript FieldStore; do not edit', scenarios })}\n`;
if (process.argv.includes('--check')) {
  const same = readFileSync(FILE, 'utf8') === text;
  console.log(same ? 'store vectors are current' : 'store vectors are OUT OF DATE: run node --experimental-transform-types scripts/rs-vectors/store.ts');
  process.exit(same ? 0 : 1);
}
writeFileSync(arg('--out') ?? FILE, text);
console.log(`wrote ${scenarios.length} scenarios, ${scenarios.reduce((n, s) => n + s.steps.length, 0)} steps`);
process.exit(0);
