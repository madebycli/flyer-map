import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { deriveNetwork, restrictToArea, ENGINE_VERSION, type Cell, type LngLat, type RawOsm } from '../src/v5/engine/index.ts';
import { pathLinkRaw } from './helpers/pathLinkCity.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { WasmEngine } from '../src/v5/engine/wasm.ts';
import { randomCity, rng } from './helpers/randomCity.ts';

const engine = await WasmEngine.load(readFileSync(new URL('../src/v5/engine/wasm/engine.wasm', import.meta.url)));
const bytes = (raw: RawOsm) => new TextEncoder().encode(JSON.stringify(raw));

/** Deep equality: exact, except two derived distances (see below). */
function same(a: unknown, b: unknown, path = '$'): void {
  if (typeof a === 'number' && typeof b === 'number') {
    // Lengths and measures come from hypot/cos, which V8 and Rust's libm may round one ulp apart; everything else is exact.
    if (/\.(length|measure)$/.test(path)) assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${path}: ${a} vs ${b}`);
    else assert.equal(a, b, path);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, `${path}: length ${a.length} vs ${b.length}`);
    a.forEach((v, i) => same(v, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    assert.deepEqual(ka, kb, `${path}: keys`);
    for (const k of ka) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  assert.equal(a, b, path);
}

const reference = (raw: RawOsm, ring: LngLat[] | null, cell: Cell | null = null) => JSON.parse(JSON.stringify(ring ? restrictToArea(deriveNetwork(raw), ring, cell) : deriveNetwork(raw)));

test('the committed wasm was built from the committed Rust sources (run scripts/build-wasm.sh after editing engine-rs)', () => {
  const root = new URL('../', import.meta.url);
  const files = [...readdirSync(new URL('engine-rs/src/', root)).map((f) => `engine-rs/src/${f}`), 'engine-rs/Cargo.toml', 'engine-rs/Cargo.lock'].sort();
  const lines = files.map((f) => `${createHash('sha256').update(readFileSync(new URL(f, root))).digest('hex')}  ${f}\n`).join('');
  const digest = createHash('sha256').update(lines).digest('hex');
  assert.equal(digest, readFileSync(new URL('src/v5/engine/wasm/engine.source.sha256', root), 'utf8').trim());
});

test('the wasm engine reports the same version as the TypeScript reference', () => {
  assert.equal(engine.version, ENGINE_VERSION);
});

for (const [w, h] of [[2, 2], [4, 3], [6, 6]] as const) {
  test(`synthetic city ${w}x${h}: identical network, with and without an Area`, () => {
    const raw = syntheticCity(w, h).raw;
    same(engine.deriveArea(bytes(raw), null), reference(raw, null));
    const M = (x: number, y: number): LngLat => [13 + x / 70053, 51 + y / 110574];
    const ring = [M(-50, -50), M(w * 100 * 0.6, -50), M(w * 100 * 0.6, h * 100), M(-50, h * 100), M(-50, -50)];
    same(engine.deriveArea(bytes(raw), ring), reference(raw, ring));
  });
}

test('garden paths linked to the street their address names: identical network in Rust and TypeScript', () => {
  same(engine.deriveArea(bytes(pathLinkRaw), null), reference(pathLinkRaw, null));
});

// ── seeded fuzz (generator in tests/helpers/randomCity.ts) ──
let fuzzTotals = { segments: 0, houses: 0, parented: 0, promoted: 0 };
test('seeded fuzz: 120 random cities (all latitudes, junction ids or coordinate keys, unicode names, odd tags) agree exactly', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const raw = randomCity(seed);
    const r = rng(seed * 31);
    const ring: LngLat[] | null = seed % 3 === 0 ? null : (() => {
      const c = raw.buildings[0].ring[0];
      const d = 0.002 + r() * 0.004;
      return [[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d], [c[0] - d, c[1] - d]] as LngLat[];
    })();
    try {
      const got = engine.deriveArea(bytes(raw), ring);
      fuzzTotals.segments += got.segments.length; fuzzTotals.houses += got.houses.length; fuzzTotals.parented += got.houses.filter((h) => h.parent).length; fuzzTotals.promoted += got.diagnostics.promotedByHouses;
      same(got, reference(raw, ring), `seed ${seed}`);
    }
    catch (error) { throw new Error(`seed ${seed}: ${(error as Error).message}`); }
  }
});

test('the fuzz exercised real work (otherwise agreement would prove nothing)', () => {
  assert.ok(fuzzTotals.segments > 500 && fuzzTotals.houses > 500 && fuzzTotals.parented > 200 && fuzzTotals.promoted > 10, JSON.stringify(fuzzTotals));
});

test('garbage and truncated input fail with a message instead of crashing', () => {
  assert.throws(() => engine.deriveArea(new TextEncoder().encode('{"ways":'), null), /pack_invalid/);
  assert.throws(() => engine.deriveArea(new TextEncoder().encode('{"ways":[1]}'), null), /pack_invalid/);
  const empty = engine.deriveArea(new TextEncoder().encode('{"ways":[],"buildings":[],"addresses":[]}'), null);
  assert.deepEqual([empty.segments.length, empty.houses.length], [0, 0]);
});

// ── parts of a big Gebiet (grid cells) ──
const cityRing = (w: number, h: number): LngLat[] => { const M = (x: number, y: number): LngLat => [13 + x / 70053, 51 + y / 110574]; return [M(-400, -500), M(w * 100 + 200, -500), M(w * 100 + 200, h * 100 + 200), M(-400, h * 100 + 200), M(-400, -500)]; };
const cellAt = (xa: number, xb: number, ya: number, yb: number): Cell => [13 + xa / 70053, 51 + ya / 110574, 13 + xb / 70053, 51 + yb / 110574];

test('with a cell, Rust and TypeScript keep exactly the same houses and street pieces', () => {
  const raw = syntheticCity(6, 6).raw;
  const ring = cityRing(6, 6);
  for (const cell of [cellAt(-400, 300, -500, 300), cellAt(300, 900, -500, 300), cellAt(-400, 300, 300, 900), cellAt(300, 900, 300, 900), cellAt(100, 250, 100, 250)]) {
    same(engine.deriveArea(bytes(raw), ring, cell), reference(raw, ring, cell), `cell ${cell.join(',')}`);
  }
});

test('the cells of a Gebiet partition it: every house and every street piece comes from exactly one part, with the parent it has in the whole', () => {
  const raw = syntheticCity(6, 6).raw;
  const ring = cityRing(6, 6);
  const whole = engine.deriveArea(bytes(raw), ring, null);
  const cells = [cellAt(-400, 300, -500, 300), cellAt(300, 900, -500, 300), cellAt(-400, 300, 300, 900), cellAt(300, 900, 300, 900)];
  const parts = cells.map((cell) => engine.deriveArea(bytes(raw), ring, cell));
  const houseIds = parts.flatMap((part) => part.houses.map((h) => h.id));
  assert.equal(new Set(houseIds).size, houseIds.length, 'no house twice');
  assert.deepEqual([...houseIds].sort(), whole.houses.map((h) => h.id).sort(), 'every house once');
  const segmentIds = parts.flatMap((part) => part.segments.map((s) => s.id));
  assert.equal(new Set(segmentIds).size, segmentIds.length, 'no street piece twice');
  assert.deepEqual([...segmentIds].sort(), whole.segments.map((s) => s.id).sort(), 'every street piece once');
  const parentOf = new Map(whole.houses.map((h) => [h.id, h.parent]));
  for (const part of parts) for (const house of part.houses) assert.equal(house.parent, parentOf.get(house.id), `parent of ${house.id}`);
  assert.ok(parts.filter((part) => part.houses.length > 0).length >= 3, 'the city really spreads over the cells');
});
