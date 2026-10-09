import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EngineHost } from '../src/v5/engine/host.ts';
import { buildGraph, routeSegments, mergeNetworks, type LngLat, type RawOsm } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { encodePack } from '../src/v5/engine/pack.ts';
import { randomCity } from './helpers/randomCity.ts';

const wasmBytes = readFileSync(new URL('../src/v5/engine/wasm/engine.wasm', import.meta.url));
const ringAround = (raw: RawOsm): LngLat[] => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const way of raw.ways) for (const [x, y] of way.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w - 0.01, s - 0.01], [e + 0.01, s - 0.01], [e + 0.01, n + 0.01], [w - 0.01, n + 0.01], [w - 0.01, s - 0.01]];
};

async function hosts(raw: RawOsm) {
  const pack = await encodePack(raw);
  const wasm = new EngineHost(), ts = new EngineHost();
  assert.equal(await wasm.init(() => wasmBytes), 'wasm');
  assert.equal(await ts.init(null), 'ts');
  const ring = ringAround(raw);
  const a = await wasm.area({ areaId: 'a', ring, pack });
  await ts.area({ areaId: 'a', ring, pack: await encodePack(raw) });
  return { wasm, ts, network: a.network };
}

/** Small deterministic generator (the test must not depend on Math.random). */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('Rust routing equals the TypeScript reference on random cities (ids, length, ambiguity, disconnected)', async () => {
  let compared = 0, selected = 0, ambiguous = 0, disconnected = 0;
  for (const seed of [3, 7, 11, 19, 23]) {
    const { wasm, network } = await hosts(randomCity(seed));
    const graph = buildGraph(network);
    const ids = network.segments.map((s) => s.id);
    const next = rng(seed * 977);
    for (let i = 0; i < 120; i++) {
      const count = 1 + Math.floor(next() * 3);
      const anchors = Array.from({ length: count }, () => ids[Math.floor(next() * ids.length)]);
      const expected = routeSegments(graph, anchors);
      const got = wasm.route(anchors);
      assert.deepEqual(got, expected, `seed ${seed} anchors ${anchors.join(',')}`);
      compared++;
      if (expected.state === 'selected') { selected++; if (expected.ambiguous) ambiguous++; } else disconnected++;
    }
  }
  assert.ok(selected > 100 && disconnected > 0, `selected ${selected}, ambiguous ${ambiguous}, disconnected ${disconnected} of ${compared}`);
});

test('routing: unknown ids and empty input are disconnected in both engines; the TypeScript host agrees with Rust', async () => {
  const { wasm, ts, network } = await hosts(syntheticCity(4, 3).raw);
  const a = network.segments[0].id, b = network.segments.at(-1)!.id;
  for (const host of [wasm, ts]) {
    assert.deepEqual(host.route(['nope']), { state: 'disconnected' });
    assert.deepEqual(host.route([a, 'nope']), { state: 'disconnected' });
    assert.deepEqual(host.route([]), { state: 'disconnected' });
  }
  assert.deepEqual(ts.route([a, b]), wasm.route([a, b]));
  assert.deepEqual(wasm.route([a]), { state: 'selected', segmentIds: [a], length: network.segments[0].length, ambiguous: false });
});

test('routing across two merged Areas uses the merged graph (first Area wins)', async () => {
  const raw = syntheticCity(4, 3).raw;
  const ring = ringAround(raw);
  const pack = await encodePack(raw);
  const host = new EngineHost();
  await host.init(() => wasmBytes);
  const first = (await host.area({ areaId: 'a', ring, pack })).network;
  const second = (await host.area({ areaId: 'b', ring, pack: await encodePack(raw) })).network;
  const merged = mergeNetworks([{ areaId: 'a', network: first }, { areaId: 'b', network: second }]).network;
  assert.equal(merged.segments.length, first.segments.length, 'an identical second Area adds nothing');
  const ids = first.segments.map((s) => s.id);
  assert.deepEqual(host.route([ids[0], ids.at(-1)!]), routeSegments(buildGraph(merged), [ids[0], ids.at(-1)!]));
});
