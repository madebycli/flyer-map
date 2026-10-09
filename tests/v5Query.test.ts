import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EngineHost } from '../src/v5/engine/host.ts';
import { buildSearchIndex, fold, searchEntries } from '../src/v5/engine/search.ts';
import { lassoSelect } from '../src/v5/engine/lasso.ts';
import { encodePack } from '../src/v5/engine/pack.ts';
import type { FieldNetwork, LngLat, RawOsm } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { randomCity, rng } from './helpers/randomCity.ts';

const wasmBytes = readFileSync(new URL('../src/v5/engine/wasm/engine.wasm', import.meta.url));
const ringAround = (raw: RawOsm): LngLat[] => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const way of raw.ways) for (const [x, y] of way.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  for (const b of raw.buildings) for (const [x, y] of b.ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w - 0.01, s - 0.01], [e + 0.01, s - 0.01], [e + 0.01, n + 0.01], [w - 0.01, n + 0.01], [w - 0.01, s - 0.01]];
};
async function engines(raw: RawOsm) {
  const wasm = new EngineHost();
  assert.equal(await wasm.init(() => wasmBytes), 'wasm');
  const network = (await wasm.area({ areaId: 'a', ring: ringAround(raw), pack: await encodePack(raw) })).network;
  const ts = new EngineHost();
  await ts.init(null);
  await ts.area({ areaId: 'a', ring: ringAround(raw), pack: await encodePack(raw) });
  return { wasm, ts, network };
}

const variants = (s: string) => [s, s.toUpperCase(), s.toLowerCase(), s.replace(/straße/giu, 'str.'), s.replace(/ß/gu, 'ss'), s.replace(/[äöü]/giu, (c) => ({ ä: 'a', ö: 'o', ü: 'u', Ä: 'A', Ö: 'O', Ü: 'U' })[c]!), s.slice(0, 4), s.slice(2, 7), s.split(' ')[0], s.split(' ').reverse().join(' '), `  ${s}  `];

test('Rust search equals the TypeScript reference on random cities: same hits, same order, for messy spellings', async () => {
  let queries = 0, nonEmpty = 0;
  for (const seed of [3, 7, 11, 19, 23, 41]) {
    const { wasm, network } = await engines(randomCity(seed));
    const index = buildSearchIndex(network);
    const next = rng(seed * 31);
    const pool: string[] = [...new Set(index.map((e) => e.label))];
    const fixed = ['', ' ', 'str', 'str.', 'Str. 5', 'straße', 'STRASSE', 'haupt', 'Hauptstr', 'ä', 'ß', 'i̇s', 'istiklal', 'caddesi', '17', '17. juni', 'am markt', 'am  markt', 'a', '1', '99a', 'zzzz'];
    for (const q of [...fixed, ...Array.from({ length: 80 }, () => variants(pool[Math.floor(next() * pool.length)] ?? 'x')[Math.floor(next() * 11)])]) {
      const expected = searchEntries(index, q, 30);
      assert.deepEqual(wasm.search(q, 30), expected, `seed ${seed} query ${JSON.stringify(q)}`);
      queries++; if (expected.length) nonEmpty++;
    }
  }
  assert.ok(queries > 500 && nonEmpty > 200, `${nonEmpty}/${queries}`);
});

test('the TypeScript fallback host answers search and lasso like Rust, over two merged Areas', async () => {
  const raw = syntheticCity(4, 3).raw;
  const wasm = new EngineHost(), ts = new EngineHost();
  await wasm.init(() => wasmBytes); await ts.init(null);
  const ring = ringAround(raw);
  for (const host of [wasm, ts]) { await host.area({ areaId: 'a', ring, pack: await encodePack(raw) }); await host.area({ areaId: 'b', ring, pack: await encodePack(raw) }); }
  for (const q of ['quer', 'Querstr. 1', 'längsweg', 'stich', 'waldweg', '7']) assert.deepEqual(ts.search(q), wasm.search(q), q);
  assert.ok(wasm.search('querstr').some((h) => h.kind === 'street'));
  const around: LngLat[] = [[12.99, 50.99], [13.02, 50.99], [13.02, 51.02], [12.99, 51.02]];
  assert.deepEqual(ts.lasso(around, false), wasm.lasso(around, false));
});

/** A random simple-ish polygon (star-shaped around a centre, so concave but never self-crossing) in lng/lat. */
function blob(next: () => number, c: LngLat, radiusM: number): LngLat[] {
  const n = 5 + Math.floor(next() * 9), kx = 111_320 * Math.cos((c[1] * Math.PI) / 180), ky = 110_574;
  return Array.from({ length: n }, (_, i): LngLat => { const a = (i / n) * Math.PI * 2, r = radiusM * (0.35 + next() * 0.65); return [c[0] + (Math.cos(a) * r) / kx, c[1] + (Math.sin(a) * r) / ky]; });
}

test('Rust lasso equals the TypeScript reference on random cities and random shapes (ids and order), with and without "nur mit Häusern"', async () => {
  let compared = 0, hitsHouses = 0, hitsSegments = 0;
  for (const seed of [3, 7, 11, 19, 23, 41]) {
    const raw = randomCity(seed);
    const { wasm, network } = await engines(raw);
    const next = rng(seed * 7);
    const lng = network.houses.map((h) => h.center[0]), lat = network.houses.map((h) => h.center[1]);
    const centre: LngLat = [(Math.min(...lng) + Math.max(...lng)) / 2, (Math.min(...lat) + Math.max(...lat)) / 2];
    for (let i = 0; i < 40; i++) {
      const c: LngLat = [centre[0] + (next() - 0.5) * 0.006, centre[1] + (next() - 0.5) * 0.006];
      const ring = blob(next, c, 40 + next() * 500);
      for (const housesOnly of [false, true]) {
        const expected = lassoSelect(network as FieldNetwork, ring, housesOnly);
        assert.deepEqual(wasm.lasso(ring, housesOnly), expected, `seed ${seed} #${i} housesOnly=${housesOnly}`);
        compared++; hitsHouses += expected.houses.length; hitsSegments += expected.segments.length;
      }
    }
    assert.deepEqual(wasm.lasso([[13, 51], [13.1, 51.1]], false), { houses: [], segments: [] }, 'fewer than three points select nothing');
  }
  assert.ok(compared === 480 && hitsHouses > 100 && hitsSegments > 100, `${hitsHouses} houses / ${hitsSegments} segments over ${compared} lassos`);
});

test('fold: the documented spellings agree', () => {
  assert.equal(fold('Große Straße'), 'grosse strasse');
  assert.equal(fold('Hauptstr. 4'), fold('Hauptstrasse 4'));
  assert.equal(fold('  Am   Markt '), 'am markt');
  assert.equal(fold('STR'), 'strasse');
  assert.equal(fold('Astra'), 'astra', 'no boundary, no replacement');
});
