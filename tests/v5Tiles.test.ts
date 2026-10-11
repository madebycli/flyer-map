import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { deriveNetwork, restrictToArea, slimNetwork, snapToNetworks, type LngLat, type Network, type RawOsm } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { WasmEngine } from '../src/v5/engine/wasm.ts';
import { randomCity } from './helpers/randomCity.ts';

const wasm = readFileSync(new URL('../src/v5/engine/wasm/engine.wasm', import.meta.url));
const bytes = (raw: RawOsm) => new TextEncoder().encode(JSON.stringify(raw));
const M = (x: number, y: number): LngLat => [13 + x / 70053, 51 + y / 110574];
const bigRing = (w: number, h: number): LngLat[] => [M(-300, -400), M(w * 100 + 100, -400), M(w * 100 + 100, h * 100 + 100), M(-300, h * 100 + 100), M(-300, -400)];

const tileOf = (lng: number, lat: number, z: number) => {
  const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180);
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n) };
};
/** Tile coordinate → lng/lat, so geometry in a tile can be compared with the network it was cut from. */
const fromTile = (z: number, tx: number, ty: number, px: number, py: number): LngLat => {
  const n = 2 ** z, x = (tx + px / 4096) / n, y = (ty + py / 4096) / n;
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
};
const decode = (buf: Uint8Array) => new VectorTile(new PbfReader(buf));

async function session(raw: RawOsm, ring: LngLat[]) {
  const engine = await WasmEngine.load(wasm);
  engine.resetSession();
  const slim = engine.addArea(bytes(raw), ring);
  const full = restrictToArea(deriveNetwork(raw), ring);
  return { engine, slim, full };
}

test('the slim network equals the TypeScript engine\'s slim view exactly (midpoints included)', async () => {
  for (const seed of [3, 7, 11, 19]) {
    const raw = randomCity(seed);
    const c = raw.buildings[0].ring[0];
    const ring: LngLat[] = [[c[0] - 0.005, c[1] - 0.005], [c[0] + 0.005, c[1] - 0.005], [c[0] + 0.005, c[1] + 0.005], [c[0] - 0.005, c[1] + 0.005], [c[0] - 0.005, c[1] - 0.005]];
    const { slim, full } = await session(raw, ring);
    const ts = JSON.parse(JSON.stringify(slimNetwork(full)));
    assert.equal(slim.segments.length, ts.segments.length);
    slim.segments.forEach((s, i) => {
      const t = ts.segments[i];
      assert.deepEqual({ ...s, length: 0 }, { ...t, length: 0 });
      assert.ok(Math.abs(s.length - t.length) < 1e-9);
    });
    assert.deepEqual(slim.houses.map((h) => ({ ...h, measure: null })), ts.houses.map((h: object) => ({ ...h, measure: null })));
  }
});

test('tiles: layers, feature keys and geometry match the network (z17, a block of the synthetic city)', async () => {
  const raw = syntheticCity(4, 4).raw;
  const { engine, full } = await session(raw, bigRing(4, 4));
  const z = 17, { x, y } = tileOf(...M(150, 150), z);
  const tile = decode(engine.tile(z, x, y));
  assert.deepEqual(Object.keys(tile.layers).sort(), ['houses', 'segments'], 'no dots layer at z17');
  const houses = tile.layers.houses, segments = tile.layers.segments;
  const feats = (layer: typeof houses) => Array.from({ length: layer.length }, (_, i) => layer.feature(i));
  const hKeys = feats(houses).map((f) => f.properties.key as string);
  assert.equal(new Set(hKeys).size, hKeys.length, 'one feature per house (a house is not split across features)');
  // every house whose centre is inside the tile is present with its number, and its first ring vertex is where the network says
  const byKey = new Map(full.houses.map((h) => [`h:${h.id}`, h]));
  let checked = 0;
  for (const f of feats(houses)) {
    const h = byKey.get(f.properties.key as string)!;
    assert.ok(h, 'feature belongs to a real house');
    assert.equal(f.properties.num, h.number ?? '');
    assert.equal(f.type, 3);
    const ring = f.loadGeometry()[0];
    const area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p.x * q.y - q.x * p.y; }, 0);
    assert.ok(area > 0, 'exterior ring winding is positive in tile space (MVT rule)');
    const inside = ring.every((p) => p.x >= 0 && p.x <= 4096 && p.y >= 0 && p.y <= 4096);
    if (inside) {
      const got = fromTile(z, x, y, ring[0].x, ring[0].y);
      const ok = h.ring.some((p) => Math.hypot((p[0] - got[0]) * 70053, (p[1] - got[1]) * 110574) < 0.2);
      assert.ok(ok, `${f.properties.key}: vertex within 0.2 m`);
      checked++;
    }
  }
  assert.ok(checked > 3, `checked ${checked} full houses`);
  const sKeys = feats(segments).map((f) => f.properties.key as string);
  const visibleHere = new Set(full.segments.filter((s) => s.visible).map((s) => `s:${s.id}`));
  assert.ok(sKeys.length > 0 && sKeys.every((k) => visibleHere.has(k)), 'only visible street pieces are in tiles');
  assert.ok(feats(segments).every((f) => f.type === 2));
  // "Nur Straßen mit Häusern": h = 1 exactly when the junction-to-junction street has a house
  const groupHouses = new Map<string, number>();
  for (const s of full.segments) groupHouses.set(s.group, (groupHouses.get(s.group) ?? 0) + s.houseCount);
  const segByKey = new Map(full.segments.map((s) => [`s:${s.id}`, s]));
  for (const f of feats(segments)) {
    const seg = segByKey.get(f.properties.key as string)!;
    assert.equal(f.properties.h, (groupHouses.get(seg.group) ?? 0) > 0 ? '1' : '0', `${f.properties.key}: h`);
  }
});

test('tiles: every house and every visible street piece appears in at least one tile of its zoom level (nothing lost at tile borders)', async () => {
  const raw = syntheticCity(5, 5).raw;
  const { engine, full } = await session(raw, bigRing(5, 5));
  for (const z of [15, 16, 17]) {
    const from = tileOf(...M(-300, -400), z), to = tileOf(...M(700, 700), z);
    const seenH = new Set<string>(), seenS = new Set<string>();
    for (let tx = from.x; tx <= to.x; tx++) for (let ty = to.y; ty <= from.y; ty++) {
      const buf = engine.tile(z, tx, ty);
      if (!buf.length) continue;
      const t = decode(buf);
      for (const [name, set] of [['houses', seenH], ['segments', seenS]] as const) {
        const l = t.layers[name];
        for (let i = 0; l && i < l.length; i++) set.add(l.feature(i).properties.key as string);
      }
    }
    assert.equal(seenH.size, full.houses.length, `z${z}: houses`);
    assert.equal(seenS.size, full.segments.filter((s) => s.visible).length, `z${z}: segments`);
  }
});

test('tiles: dots (centres) up to z15, outlines from z15, nothing below z11; empty tiles are empty', async () => {
  const raw = syntheticCity(3, 3).raw;
  const { engine } = await session(raw, bigRing(3, 3));
  const layers = (z: number) => { const { x, y } = tileOf(...M(150, 150), z); const b = engine.tile(z, x, y); return b.length ? Object.keys(decode(b).layers).sort() : []; };
  assert.deepEqual(layers(10), []);
  assert.deepEqual(layers(13), ['centers'], 'no streets below z14');
  assert.deepEqual(layers(14), ['centers', 'segments']);
  assert.deepEqual(layers(15), ['centers', 'houses', 'segments']);
  assert.deepEqual(layers(16), ['houses', 'segments']);
  assert.equal(engine.tile(17, 0, 0).length, 0, 'far away from the data');
});

test('areas merge "first Area wins": an overlapping second Area adds nothing twice', async () => {
  const raw = syntheticCity(3, 3).raw;
  const engine = await WasmEngine.load(wasm);
  engine.resetSession();
  engine.addArea(bytes(raw), bigRing(3, 3));
  const z = 16, { x, y } = tileOf(...M(150, 150), z);
  const once = engine.tile(z, x, y);
  engine.addArea(bytes(raw), bigRing(3, 3));
  assert.deepEqual(engine.tile(z, x, y), once);
});

test('a cached Area blob restores the same network and byte-identical tiles', async () => {
  const raw = syntheticCity(4, 3).raw;
  const a = await WasmEngine.load(wasm);
  a.resetSession();
  const slim = a.addArea(bytes(raw), bigRing(4, 3), true);
  const blob = a.exportLastArea();
  const b = await WasmEngine.load(wasm);
  b.resetSession();
  const again = b.addBlob(blob);
  assert.deepEqual(again, slim);
  const z = 17, { x, y } = tileOf(...M(150, 150), z);
  assert.deepEqual(b.tile(z, x, y), a.tile(z, x, y));
  assert.throws(() => b.addBlob(new Uint8Array([1, 2, 3])), /blob_invalid/);
});

test('snap: a tap beside a house lands on it with its address; beside a street on the street; far away nowhere', async () => {
  const raw = syntheticCity(4, 4).raw;
  const { engine, full } = await session(raw, bigRing(4, 4));
  const house = full.houses.find((h) => h.street && h.number)!;
  const near = engine.snap(house.center[0] + 8 / 70053, house.center[1] + 5 / 110574);
  assert.equal(near.kind, 1);
  assert.deepEqual(near.position, house.center);
  assert.equal(near.address, `${house.street} ${house.number}`);
  const seg = full.segments.find((s) => s.visible && s.name)!;
  const mid = seg.coords[Math.floor(seg.coords.length / 2)];
  const onStreet = engine.snap(mid[0] + 3 / 70053, mid[1] + 3 / 110574, 1, 22);
  assert.equal(onStreet.kind, 2);
  assert.equal(onStreet.address, seg.name);
  assert.equal(engine.snap(14.5, 52.5).kind, 0);
});

test('snap: Rust and TypeScript agree on 300 random taps over a random city (position, address, kind)', async () => {
  const raw = randomCity(9);
  const c = raw.buildings[0].ring[0];
  const ring: LngLat[] = [[c[0] - 0.01, c[1] - 0.01], [c[0] + 0.01, c[1] - 0.01], [c[0] + 0.01, c[1] + 0.01], [c[0] - 0.01, c[1] + 0.01], [c[0] - 0.01, c[1] - 0.01]];
  const { engine, full } = await session(raw, ring);
  const r = ((seed) => () => (seed = (seed * 48271) % 2147483647) / 2147483647)(1234567);
  let houses = 0, streets = 0;
  for (let i = 0; i < 300; i++) {
    const at: LngLat = [c[0] + (r() - 0.5) * 0.004, c[1] + (r() - 0.5) * 0.004];
    const a = engine.snap(at[0], at[1], 30, 22), b = snapToNetworks([full], at, 30, 22);
    assert.equal(a.kind, b.kind);
    assert.equal(a.address, b.address);
    assert.ok(Math.abs(a.position[0] - b.position[0]) < 1e-9 && Math.abs(a.position[1] - b.position[1]) < 1e-9, `tap ${i}`);
    if (a.kind === 1) houses++; else if (a.kind === 2) streets++;
  }
  assert.ok(houses > 10 && streets > 10, `${houses} house snaps, ${streets} street snaps`);
});

test('tile cutting is fast: a z16 tile of a 39 k-house city in a few milliseconds', async () => {
  const raw = syntheticCity(70, 70).raw;
  const { engine } = await session(raw, bigRing(70, 70));
  const z = 16, { x, y } = tileOf(...M(3500, 3500), z);
  engine.tile(z, x, y);
  const t = performance.now();
  for (let i = 0; i < 20; i++) engine.tile(z, x, y);
  const ms = (performance.now() - t) / 20;
  assert.ok(ms < 50, `${ms.toFixed(1)} ms per tile`);
});

const tilesCovering = (z: number, w: number) => {
  const from = tileOf(...M(-300, -400), z), to = tileOf(...M(w * 100 + 100, w * 100 + 100), z), out: [number, number][] = [];
  for (let tx = from.x; tx <= to.x; tx++) for (let ty = to.y; ty <= from.y; ty++) out.push([tx, ty]);
  return out;
};

test('tiles: the dots are thinned at low zoom (one per ~1.5 px), complete from z14; the streets start at z14', async () => {
  const raw = syntheticCity(14, 14).raw;
  const { engine, full } = await session(raw, bigRing(14, 14));
  const dots = (z: number) => {
    const keys = new Set<string>(); let bytes = 0;
    for (const [tx, ty] of tilesCovering(z, 14)) {
      const buf = engine.tile(z, tx, ty); bytes += buf.length;
      const l = buf.length ? decode(buf).layers.centers : undefined;
      for (let i = 0; l && i < l.length; i++) keys.add(l.feature(i).properties.key as string);
    }
    return { keys: keys.size, bytes };
  };
  const total = full.houses.length;
  assert.ok(total > 300);
  const z11 = dots(11), z12 = dots(12), z14 = dots(14);
  assert.ok(z11.keys > 0 && z11.keys < total * 0.8, `z11 thinned (${z11.keys} of ${total})`);
  assert.ok(z11.keys <= z12.keys && z12.keys < total, `z12 thinned (${z12.keys} of ${total})`);
  assert.equal(z14.keys, total, 'z14: every house has its dot');
  for (const z of [11, 12, 13]) for (const [tx, ty] of tilesCovering(z, 14)) { const b = engine.tile(z, tx, ty); if (b.length) assert.equal(decode(b).layers.segments, undefined, `z${z}: no streets`); }
});

test('tiles: the engine cuts the status of an entity into the tile (st), 0 takes it back; open entities carry nothing', async () => {
  const raw = syntheticCity(4, 4).raw;
  const { engine, full } = await session(raw, bigRing(4, 4));
  const house = full.houses[0], street = full.segments.find((s) => s.visible)!;
  const other = full.houses[1];
  engine.setStatus([[`h:${house.id}`, 1], [`h:${other.id}`, 2], [`s:${street.id}`, 3]]);
  const st = (z: number, layer: 'houses' | 'segments' | 'centers') => {
    const out = new Map<string, string | undefined>();
    for (const [tx, ty] of tilesCovering(z, 4)) {
      const b = engine.tile(z, tx, ty); const l = b.length ? decode(b).layers[layer] : undefined;
      for (let i = 0; l && i < l.length; i++) { const p = l.feature(i).properties; out.set(p.key as string, p.st as string | undefined); }
    }
    return out;
  };
  const houses = st(17, 'houses'), segments = st(17, 'segments'), dots = st(14, 'centers');
  assert.equal(houses.get(`h:${house.id}`), 'c');
  assert.equal(houses.get(`h:${other.id}`), 'l');
  assert.equal(segments.get(`s:${street.id}`), 'n');
  assert.equal(dots.get(`h:${house.id}`), 'c', 'the dots carry it too');
  assert.ok([...houses].filter(([, v]) => v !== undefined).length === 2, 'only the two houses with a status');
  engine.setStatus([[`h:${house.id}`, 0]]);
  assert.equal(st(17, 'houses').get(`h:${house.id}`), undefined);
  assert.equal(st(17, 'houses').get(`h:${other.id}`), 'l');
  assert.throws(() => engine.setStatus('nope' as never), /./);
});

test('bakeStatuses: hands the engine every status that is not open and reports what it was given', async () => {
  const { bakeStatuses } = await import('../src/v5/map/bake.ts');
  const entries = new Map([['h:1', { status: 'completed' }], ['h:2', { status: 'open' }], ['s:3', { status: 'later' }], ['h:4', { status: 'not-deliverable' }]]);
  const sent: [string, number][][] = [];
  const baked = await bakeStatuses({ entries: () => entries.entries() } as never, { setStatus: async (e) => { sent.push(e); } });
  assert.deepEqual(sent[0], [['h:1', 1], ['s:3', 2], ['h:4', 3]]);
  assert.deepEqual([...baked!.baseline.keys()], ['h:1', 's:3', 'h:4']);
  baked!.send([['h:1', 'open']]);
  assert.deepEqual(sent[1], [['h:1', 0]]);
  assert.equal(await bakeStatuses({ entries: () => entries.entries() } as never, { setStatus: async () => { throw new Error('x'); } }), null, 'an engine that cannot: the map paints everything itself');
});
