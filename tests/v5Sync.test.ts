import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldStore, type Conflict } from '../src/v5/store/store.ts';
import { SyncClient, type SyncTransport } from '../src/v5/store/syncClient.ts';
import type { Op, Status } from '../src/v5/store/types.ts';

/** In-memory server with the real semantics: one row per key, last writer wins by op id, a sequence number per change. */
class SimServer {
  rows = new Map<string, { op: Op; seq: number }>();
  seq = 0;
  clock = 1_800_000_000_000;
  push(ops: Op[]) { for (const op of ops) { const cur = this.rows.get(op.key); if (!cur || op.id > cur.op.id) this.rows.set(op.key, { op, seq: ++this.seq }); } }
  pull(since: number) { const rows = [...this.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq); return { ops: rows.map((r) => r.op), cursor: rows.length ? rows[rows.length - 1].seq : since, serverNow: this.clock }; }
  status(key: string): Status { return this.rows.get(key)?.op.status ?? 'open'; }
}

type Faults = { dropPushResponse?: boolean; failNext?: boolean };
function replica(server: SimServer, name: string, offsetMs = 0, faults: Faults = {}) {
  const store = new FieldStore(name, null, () => server.clock + offsetMs);
  const transport: SyncTransport = {
    pull: async (since) => { if (faults.failNext) { faults.failNext = false; throw new Error('offline'); } return server.pull(since); },
    push: async (ops) => {
      if (faults.failNext) { faults.failNext = false; throw new Error('offline'); }
      server.push(ops);
      if (faults.dropPushResponse) { faults.dropPushResponse = false; throw new Error('response lost'); } // applied, but the client never hears back
      return { accepted: ops.map((o) => o.id), cursor: server.seq };
    },
  };
  const client = new SyncClient(store, transport, 50);
  const conflicts: Conflict[] = [];
  store.subscribeConflicts((all) => { conflicts.splice(0, conflicts.length, ...all); });
  return { store, client, conflicts, faults, name, sync: async () => { await client.run(); await new Promise((r) => setTimeout(r, 0)); } };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('two devices overwrite the same street at the same moment: one winner everywhere, the loser is told', async () => {
  const server = new SimServer();
  const a = replica(server, 'alice'), b = replica(server, 'bob');
  a.store.set('s:x', 'completed');
  b.store.set('s:x', 'later');
  await a.sync(); await b.sync(); await a.sync(); await b.sync();
  assert.equal(a.store.statusOf('s:x'), b.store.statusOf('s:x'));
  assert.equal(a.store.statusOf('s:x'), server.status('s:x'));
  const loser = a.conflicts.length ? a : b, winner = loser === a ? b : a;
  assert.equal(loser.conflicts.length, 1);
  assert.equal(winner.conflicts.length, 0);
  assert.equal(loser.conflicts[0].theirs, winner.store.statusOf('s:x'));
  // an explicit "restore mine" is a new, later edit and wins for everybody
  const mine = loser.conflicts[0].mine;
  loser.store.dismissConflicts();
  loser.store.set('s:x', mine);
  await loser.sync(); await winner.sync();
  assert.deepEqual([a.store.statusOf('s:x'), b.store.statusOf('s:x'), server.status('s:x')], [mine, mine, mine]);
  a.client.dispose(); b.client.dispose();
});

test('a change that came from the server is never reverted by later syncs, acks or pushes', async () => {
  const server = new SimServer();
  const a = replica(server, 'alice'), b = replica(server, 'bob');
  server.clock += 1000; b.store.set('h:1', 'completed');
  await b.sync();
  server.clock += 1000; a.store.set('h:2', 'later'); // alice never saw h:1 yet
  for (let i = 0; i < 6; i++) { await a.sync(); await b.sync(); }
  for (const r of [a, b]) { assert.equal(r.store.statusOf('h:1'), 'completed'); assert.equal(r.store.statusOf('h:2'), 'later'); }
  assert.equal(a.conflicts.length + b.conflicts.length, 0, 'edits on different keys are never conflicts');
  a.client.dispose(); b.client.dispose();
});

test('an older server value cannot override a newer local edit that is still queued', async () => {
  const server = new SimServer();
  const a = replica(server, 'alice'), b = replica(server, 'bob');
  b.store.set('h:7', 'later'); await b.sync();
  server.clock += 5000;
  a.faults.failNext = true; a.store.set('h:7', 'completed'); // newer, but offline
  await a.sync(); // fails
  assert.equal(a.store.pendingOps().length, 1);
  await a.sync(); // pull + push now succeed
  assert.equal(a.store.statusOf('h:7'), 'completed');
  await b.sync();
  assert.equal(b.store.statusOf('h:7'), 'completed');
  assert.equal(b.conflicts.length, 1, 'bob learns that his value was replaced');
  a.client.dispose(); b.client.dispose();
});

test('lost acknowledgements and duplicate deliveries change nothing', async () => {
  const server = new SimServer();
  const a = replica(server, 'alice', 0, { dropPushResponse: true }), b = replica(server, 'bob');
  a.store.set('h:1', 'completed');
  await a.sync(); // applied on the server, response lost
  assert.equal(a.store.pendingOps().length, 1);
  await a.sync(); // same op sent again
  assert.equal(a.store.pendingOps().length, 0);
  assert.equal(server.rows.size, 1);
  await b.sync();
  assert.equal(b.store.statusOf('h:1'), 'completed');
  const stable = JSON.stringify([...server.rows]);
  for (let i = 0; i < 4; i++) { await a.sync(); await b.sync(); }
  assert.equal(JSON.stringify([...server.rows]), stable);
  a.client.dispose(); b.client.dispose();
});

test('a long offline session merges with everybody else without losing a single edit', async () => {
  const server = new SimServer();
  const offline = replica(server, 'offline'), others = [replica(server, 'o1'), replica(server, 'o2')];
  const keys = Array.from({ length: 60 }, (_, i) => `h:${i}`);
  offline.faults.failNext = true;
  for (const key of keys.slice(0, 30)) offline.store.set(key, 'completed');
  await offline.sync();
  for (const [i, r] of others.entries()) { for (const key of keys.slice(30 + i * 15, 45 + i * 15)) { server.clock += 10; r.store.set(key, 'later'); } await r.sync(); }
  await offline.sync(); // back online
  for (const r of [...others, offline]) await r.sync();
  for (const r of [...others, offline]) {
    keys.slice(0, 30).forEach((k) => assert.equal(r.store.statusOf(k), 'completed', `${r.name} ${k}`));
    keys.slice(30, 60).forEach((k) => assert.equal(r.store.statusOf(k), 'later', `${r.name} ${k}`));
  }
  assert.equal(offline.conflicts.length, 0);
  [offline, ...others].forEach((r) => r.client.dispose());
});

test('a device whose clock is an hour off is corrected by the server and still wins when it edits last', async () => {
  const server = new SimServer();
  const slow = replica(server, 'slow', -3_600_000), fast = replica(server, 'fast', +3_600_000), right = replica(server, 'right');
  await slow.sync(); await fast.sync(); // the first pull teaches them the server time
  server.clock += 1000; right.store.set('h:1', 'later'); await right.sync();
  server.clock += 1000; slow.store.set('h:1', 'completed'); await slow.sync();
  await right.sync(); await fast.sync();
  for (const r of [slow, fast, right]) assert.equal(r.store.statusOf('h:1'), 'completed', r.name);
  server.clock += 1000; fast.store.set('h:1', 'not-deliverable'); await fast.sync(); await right.sync(); await slow.sync();
  for (const r of [slow, fast, right]) assert.equal(r.store.statusOf('h:1'), 'not-deliverable', r.name);
  [slow, fast, right].forEach((r) => r.client.dispose());
});

/** tiny deterministic PRNG so a failing seed can be replayed */
const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

test('fuzz: random edits, sync order, lost responses and offline spells always converge to the last writer, never regress', async () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rand = rng(seed), server = new SimServer();
    const names = ['a', 'b', 'c', 'd'];
    const reps = names.map((n, i) => replica(server, n, [0, -120_000, 90_000, 0][i]));
    const keys = Array.from({ length: 12 }, (_, i) => `${i % 3 ? 'h' : 's'}:k${i}`);
    const statuses: Status[] = ['open', 'completed', 'later', 'not-deliverable'];
    const issued = new Map<string, Op>();
    const highest = new Map<string, string>(); // per replica+key: the winning op id must never go down
    for (let step = 0; step < 160; step++) {
      server.clock += Math.floor(rand() * 400);
      const r = reps[Math.floor(rand() * reps.length)];
      const roll = rand();
      if (roll < 0.5) {
        const key = keys[Math.floor(rand() * keys.length)];
        for (const op of r.store.set(key, statuses[Math.floor(rand() * statuses.length)])) { const cur = issued.get(key); if (!cur || op.id > cur.id) issued.set(key, op); }
      } else {
        if (rand() < 0.25) r.faults.failNext = true;
        if (rand() < 0.15) r.faults.dropPushResponse = true;
        await r.sync();
      }
      for (const rep of reps) for (const key of keys) {
        const entry = [...rep.store.entries()].find(([k]) => k === key)?.[1];
        const id = `${rep.name}|${key}`;
        if (entry) { assert.ok(!highest.has(id) || entry.at >= highest.get(id)!, `seed ${seed}: ${id} went back in time`); highest.set(id, entry.at); }
      }
    }
    for (let round = 0; round < 3; round++) for (const r of reps) { r.faults.failNext = false; r.faults.dropPushResponse = false; await r.sync(); }
    for (const key of keys) {
      const expected = issued.get(key)?.status ?? 'open';
      assert.equal(server.status(key), expected, `seed ${seed}: server ${key}`);
      for (const r of reps) assert.equal(r.store.statusOf(key), expected, `seed ${seed}: ${r.name} ${key}`);
    }
    reps.forEach((r) => assert.equal(r.store.pendingOps().length, 0, `seed ${seed}: ${r.name} outbox drained`));
    reps.forEach((r) => r.client.dispose());
  }
});
