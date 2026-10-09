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
import { deriveNetwork, slimNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';

test('progress counters follow store changes incrementally', async () => {
  const net = deriveNetwork(syntheticCity(2, 2).raw);
  const s = new FieldStore('x', null, () => 1000);
  const p = new Progress(slimNetwork(net), s);
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

test('refused edits are rolled back locally and never retried', async () => {
  const server = new FakeServer();
  const store = new FieldStore('a', null, () => 1000);
  const transport: SyncTransport = {
    pull: async () => ({ ops: [], cursor: 0 }),
    push: async (ops) => ({ accepted: [], rejected: ops.map((o) => o.id), cursor: 0 }),
  };
  const client = new SyncClient(store, transport);
  const changes: string[] = [];
  store.subscribe((c) => { for (const [k, s] of c) changes.push(`${k}=${s}`); });
  store.set('h:foreign', 'completed');
  await tickMicro();
  await client.run();
  await tickMicro();
  assert.equal(store.statusOf('h:foreign'), 'open', 'the screen no longer shows a status the server refused');
  assert.equal(store.pendingOps().length, 0);
  assert.deepEqual(changes, ['h:foreign=completed', 'h:foreign=open']);
  void server;
  client.dispose();
});

test('a newer local edit survives the rollback of an older refused one', async () => {
  const store = new FieldStore('a', null, () => 1000);
  const [first] = store.set('h:1', 'completed');
  store.set('h:1', 'later');
  store.rollback([first.id]);
  assert.equal(store.statusOf('h:1'), 'later');
});

test('local edits hit the persisted outbox immediately, before any debounce', async () => {
  const disk = new MemoryPersistence();
  const store = new FieldStore('a', disk, () => 1000, 60_000); // debounce far in the future
  await store.hydrate();
  store.set('h:7', 'completed');
  await store.persistOutbox();
  assert.ok(disk.saves.includes('outbox'));
  const revived = new FieldStore('a', disk, () => 1000, 60_000);
  await revived.hydrate();
  assert.equal(revived.pendingOps().length, 1);
  assert.equal(revived.statusOf('h:7'), 'completed', 'pending edits are re-applied even though no overlay was saved');
});

test('a disposed sync client stops: no retries, no state callbacks', async () => {
  const store = new FieldStore('a', null, () => 1000);
  let calls = 0, states = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const transport: SyncTransport = {
    pull: async () => { calls++; await gate; throw new Error('offline'); },
    push: async () => ({ accepted: [], cursor: 0 }),
  };
  const client = new SyncClient(store, transport, 100, () => states++);
  const running = client.run();
  await tickMicro();
  const before = states;
  client.dispose();
  release();
  await running;
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(calls, 1, 'no retry was scheduled after dispose');
  assert.equal(states, before, 'no state callback after dispose');
});

import { MemoryNetworkStorage, NetworkCache } from '../src/v5/store/networkCache.ts';
import { ENGINE_VERSION } from '../src/v5/engine/index.ts';

test('network cache: hits only for the exact pack, polygon and engine it was built from', async () => {
  const storage = new MemoryNetworkStorage();
  const cache = new NetworkCache('c1', storage);
  const network = deriveNetwork(syntheticCity(2, 2).raw);
  const area = { id: 'a1', packVersion: 3, updatedAt: '2026-10-01T00:00:00Z' };
  const key = NetworkCache.keyFor(area)!;
  assert.equal(await cache.load(key), null, 'empty at first');
  await cache.store(key, network);
  assert.deepEqual((await cache.load(key))!.houses.length, network.houses.length);
  assert.equal(await cache.load({ ...key, packVersion: 4 }), null, 'a rebuilt pack invalidates');
  assert.equal(await cache.load({ ...key, updatedAt: '2026-10-02T00:00:00Z' }), null, 'a reshaped Area invalidates');
  assert.equal(await cache.load({ ...key, engine: 'older' }), null, 'a new engine version invalidates');
  assert.equal(key.engine, ENGINE_VERSION);
  assert.equal(NetworkCache.keyFor({ ...area, packVersion: null }), null, 'no pack, no key');
  await new NetworkCache('c2', storage).store(key, network);
  await cache.forget('a1');
  assert.equal(await cache.load(key), null, 'forgotten');
  assert.ok(await new NetworkCache('c2', storage).load(key), 'other campaigns keep theirs');
  const broken = new NetworkCache('c1', { get: async () => { throw new Error('quota'); }, put: async () => { throw new Error('quota'); }, delete: async () => { throw new Error('x'); } });
  assert.equal(await broken.load(key), null);
  await broken.store(key, network);
  await broken.forget('a1');
});

test('forget drops overlay entries and queued edits of vanished keys, and nothing else', async () => {
  const store = new FieldStore('a', null);
  store.set(['h:keep', 'h:gone', 's:gone'], 'completed');
  assert.equal(store.forget(['h:gone', 's:gone', 'h:never-existed']), 2);
  assert.equal(store.statusOf('h:gone'), 'open');
  assert.equal(store.statusOf('h:keep'), 'completed');
  assert.deepEqual(store.pendingOps().map((op) => op.key), ['h:keep']);
});

test('after the server refuses an edit because the key belongs to another Area, the client pulls everything again and shows the server’s truth', async () => {
  const store = new FieldStore('a', null);
  const pulled: number[] = [];
  const serverOp: Op = { id: encodeClock({ wall: 1000, counter: 0, node: 'srv' }), key: 'h:x', status: 'completed', by: 'other', area: 'area_old' };
  let stage = 0;
  const transport = {
    async push(ops: Op[]) { stage++; return { accepted: [], rejected: ops.map((o) => o.id), refetch: true, cursor: 0 }; },
    async pull(since: number) { pulled.push(since); return stage && since < 7 ? { ops: [serverOp], cursor: 7 } : { ops: [], cursor: since }; },
  };
  const client = new SyncClient(store, transport);
  await client.run();
  store.set('h:x', 'later'); // refused: rolled back locally
  await client.run();
  assert.equal(store.statusOf('h:x'), 'completed', 'the rolled-back house shows what the server holds, not "open"');
  assert.ok(pulled.includes(0) && pulled.filter((c) => c === 0).length >= 2, `pulled from the start again: ${pulled.join(',')}`);
});
