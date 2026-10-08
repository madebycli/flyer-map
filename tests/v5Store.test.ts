import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldStore, MemoryPersistence } from '../src/v5/store/store.ts';
import { decodeClock, encodeClock, receive, tick } from '../src/v5/store/hlc.ts';
import type { Op } from '../src/v5/store/types.ts';

const tickMicro = () => new Promise<void>((r) => queueMicrotask(r));

test('HLC strings sort like time, never go backwards and respect remote clocks', () => {
  let a = { wall: 0, counter: 0, node: 'a' };
  const stamps: string[] = [];
  for (const now of [1000, 1000, 900, 2000]) { a = tick(a, now); stamps.push(encodeClock(a)); }
  assert.deepEqual([...stamps].sort(), stamps, 'monotonic even when the device clock jumps back');
  const remote = encodeClock({ wall: 5_000_000, counter: 3, node: 'b' });
  a = receive(a, remote, 2000);
  assert.ok(encodeClock(tick(a, 2000)) > remote, 'local edits after a sync sort after the remote ones');
  assert.equal(decodeClock(remote)?.node, 'b');
});

test('last writer wins and replicas converge regardless of order or duplicates', () => {
  const a = new FieldStore('alice', null, () => 1000);
  const b = new FieldStore('bob', null, () => 1000);
  const opA = a.set('h:1', 'completed')[0];
  const opB = b.set('h:1', 'later')[0];
  const all: Op[] = [opA, opB];
  a.receive([...all, ...all]);
  b.receive([...all.slice().reverse(), opA]);
  assert.equal(a.statusOf('h:1'), b.statusOf('h:1'));
  assert.equal(a.statusOf('h:1'), opA.id > opB.id ? 'completed' : 'later');
});

test('listeners receive only changed keys, coalesced; no-op round trips are silent', async () => {
  const s = new FieldStore('x', null, () => 1000);
  const seen: Map<string, string>[] = [];
  s.subscribe((c) => seen.push(new Map(c)));
  s.set(['h:1', 'h:2'], 'completed');
  s.set('h:3', 'later');
  s.set('h:3', 'open'); // back to the baseline inside the same flush window
  await tickMicro();
  assert.equal(seen.length, 1);
  assert.deepEqual([...seen[0]].sort(), [['h:1', 'completed'], ['h:2', 'completed']]);
  let keyHits = 0;
  s.subscribeKey('h:1', () => keyHits++);
  s.set('h:2', 'later');
  await tickMicro();
  assert.equal(keyHits, 0, 'key listeners do not fire for other keys');
  s.set('h:1', 'later');
  await tickMicro();
  assert.equal(keyHits, 1);
});

test('outbox: pending ops survive restart and leave on acknowledge', async () => {
  const disk = new MemoryPersistence();
  const s = new FieldStore('x', disk, () => 1000, 1);
  await s.hydrate();
  const ops = s.set(['s:a', 's:b'], 'completed');
  assert.equal(s.pendingOps().length, 2);
  await s.persistNow();
  const restarted = new FieldStore('x', disk, () => 1000, 1);
  await restarted.hydrate();
  assert.equal(restarted.statusOf('s:a'), 'completed');
  assert.equal(restarted.pendingOps().length, 2);
  restarted.receive([], 7);
  restarted.acknowledge([ops[0].id]);
  assert.equal(restarted.pendingOps().length, 1);
  assert.equal(restarted.lastCursor, 7);
  const after = restarted.set('s:c', 'later')[0];
  assert.ok(after.id > ops[1].id, 'clock state is restored, ids stay monotonic');
});

test('own echoed operations clear the outbox without emitting changes', async () => {
  const s = new FieldStore('x', null, () => 1000);
  const [op] = s.set('h:9', 'completed');
  await tickMicro();
  let fired = 0;
  s.subscribe(() => fired++);
  s.receive([op], 3);
  await tickMicro();
  assert.equal(fired, 0);
  assert.equal(s.pendingOps().length, 0);
});

test('20k-key bulk edit is a single batch', async () => {
  const s = new FieldStore('x', null, () => 1000);
  let batches = 0, keys = 0;
  s.subscribe((c) => { batches++; keys += c.size; });
  s.set(Array.from({ length: 20000 }, (_, i) => `h:${i}`), 'completed');
  await tickMicro();
  assert.deepEqual([batches, keys], [1, 20000]);
});

import { Progress } from '../src/v5/store/progress.ts';
import { SyncClient, type SyncTransport } from '../src/v5/store/syncClient.ts';
import { deriveNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';

test('progress counters follow store changes incrementally', async () => {
  const net = deriveNetwork(syntheticCity(2, 2).raw);
  const s = new FieldStore('x', null, () => 1000);
  const p = new Progress(net, s);
  const total = net.houses.length;
  assert.equal(p.snapshot().houses.open, total);
  s.set([`h:${net.houses[0].id}`, `h:${net.houses[1].id}`], 'completed');
  s.set(`h:${net.houses[2].id}`, 'not-deliverable');
  await tickMicro();
  const snap = p.snapshot();
  assert.deepEqual([snap.houses.completed, snap.houses['not-deliverable'], snap.houses.open], [2, 1, total - 3]);
  assert.ok(Math.abs(snap.houseRatio - 2 / (total - 1)) < 1e-9);
  s.set(`h:${net.houses[0].id}`, 'open');
  await tickMicro();
  assert.equal(p.snapshot().houses.completed, 1);
});

class FakeServer {
  log: Op[] = [];
  transport(failFirst = 0): SyncTransport {
    let failures = failFirst;
    return {
      pull: async (since) => { return { ops: this.log.slice(since), cursor: this.log.length }; },
      push: async (ops) => { if (failures-- > 0) throw new Error('offline'); for (const op of ops) if (!this.log.some((o) => o.id === op.id)) this.log.push(op); return { accepted: ops.map((o) => o.id), cursor: this.log.length }; },
    };
  }
}

test('two clients converge through the server; offline edits are delivered later', async () => {
  const server = new FakeServer();
  const a = new FieldStore('a', null, () => 1000), b = new FieldStore('b', null, () => 1000);
  const ca = new SyncClient(a, server.transport(1)), cb = new SyncClient(b, server.transport());
  a.set('h:1', 'completed');
  b.set('s:9', 'later');
  await ca.run(); // first attempt fails (offline), op stays queued
  assert.equal(a.pendingOps().length, 1);
  assert.equal(ca.state, 'offline');
  await cb.run();
  await ca.run();
  await cb.run();
  assert.equal(a.pendingOps().length, 0);
  for (const s of [a, b]) { assert.equal(s.statusOf('h:1'), 'completed'); assert.equal(s.statusOf('s:9'), 'later'); }
  ca.dispose(); cb.dispose();
});


test('a store that was never hydrated cannot overwrite the saved outbox', async () => {
  const disk = new MemoryPersistence();
  const first = new FieldStore('x', disk, () => 1000, 1);
  await first.hydrate();
  first.set('h:1', 'completed');
  await first.persistNow();
  const early = new FieldStore('x', disk, () => 1000, 1); // e.g. a React StrictMode double mount
  await early.persistNow();
  const restarted = new FieldStore('x', disk, () => 1000, 1);
  await restarted.hydrate();
  assert.equal(restarted.pendingOps().length, 1);
  assert.equal(restarted.statusOf('h:1'), 'completed');
});

test('reconcilePending stamps missing areas and drops edits for vanished entities', async () => {
  const s = new FieldStore('x', null, () => 1000);
  s.set(['h:keep', 'h:gone'], 'completed');
  s.setAreaResolver((key) => (key === 'h:keep' ? 'area_1' : undefined));
  const dropped = s.reconcilePending((key) => key === 'h:keep');
  assert.equal(dropped, 1);
  assert.deepEqual(s.pendingOps().map((o) => [o.key, o.area]), [['h:keep', 'area_1']]);
});
