import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, classifyBuilding, classifyRoad, deriveNetwork, routeSegments } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';

test('whitelist: only known delivery roads pass, unknown highways are excluded', () => {
  assert.equal(classifyRoad({ highway: 'residential' }).cls, 'street');
  assert.equal(classifyRoad({ highway: 'service' }).cls, 'access');
  assert.equal(classifyRoad({ highway: 'service', service: 'driveway' }).cls, 'excluded');
  assert.equal(classifyRoad({ highway: 'track', name: 'Waldweg' }).cls, 'excluded');
  assert.equal(classifyRoad({ highway: 'footway', footway: 'sidewalk' }).cls, 'excluded');
  assert.equal(classifyRoad({ highway: 'path', surface: 'ground' }).cls, 'excluded');
  assert.equal(classifyRoad({ highway: 'footway', surface: 'asphalt' }).cls, 'connector');
  assert.equal(classifyRoad({ highway: 'residential', access: 'private' }).cls, 'excluded');
  assert.equal(classifyRoad({ highway: 'residential', access: 'private', foot: 'yes' }).cls, 'street');
  assert.equal(classifyRoad({ highway: 'something_new' }).cls, 'excluded');
});

test('buildings: business tags never exclude a dwelling, garages always do', () => {
  assert.equal(classifyBuilding({ building: 'house', shop: 'bakery', name: 'Bäckerei' }, true).keep, true);
  assert.equal(classifyBuilding({ building: 'garage' }, true).keep, false);
  assert.equal(classifyBuilding({ building: 'yes' }, false).keep, false);
  assert.equal(classifyBuilding({ building: 'apartments' }, false).keep, true);
  assert.equal(classifyBuilding({ building: 'barn' }, true).keep, true);
});

test('synthetic city: tricky ways are handled and every house finds its street', () => {
  const city = syntheticCity(4, 3);
  const net = deriveNetwork(city.raw);
  const waysOf = (id: number) => net.segments.filter((s) => s.wayId === id);
  assert.equal(waysOf(city.special.forestTrack).length, 0, 'forest track excluded');
  assert.equal(waysOf(city.special.sidewalk).length, 0, 'sidewalk excluded');
  assert.equal(waysOf(city.special.driveway).length, 0, 'driveway excluded');
  const cut = waysOf(city.special.cutThroughPath);
  assert.equal(cut.length, 1);
  assert.equal(cut[0].visible, false, 'house-less path stays a hidden connector');
  const back = waysOf(city.special.backLotService)[0];
  assert.equal(back.cls, 'access');
  assert.equal(back.houseCount, 3);
  assert.equal(back.visible, true, 'service road with houses is promoted');
  assert.equal(net.houses.length, city.housesExpected, 'garage dropped, bakery dwelling kept');
  assert.equal(net.diagnostics.orphanHouses, 0);
  assert.equal(net.diagnostics.buildingsSkipped['non_dwelling_garage'], 1);
  assert.ok(net.houses.some((h) => h.number === '7' && h.parent));
});

test('a side street at an interior node splits the through street and is routable', () => {
  const city = syntheticCity(4, 3);
  const net = deriveNetwork(city.raw);
  const through = net.segments.filter((s) => s.wayId === city.special.throughStreet);
  assert.ok(through.length >= 5, 'through street is noded at crossings and at the side-street junction');
  const side = net.segments.find((s) => s.wayId === city.special.sideStreet)!;
  const far = net.segments.find((s) => s.name === 'Längsweg 5' && s.visible)!;
  const route = routeSegments(net, [side.id, far.id]);
  assert.equal(route.state, 'selected');
});

test('derivation is deterministic and input-order independent', () => {
  const city = syntheticCity(3, 3);
  const a = deriveNetwork(city.raw);
  const shuffled = { ways: [...city.raw.ways].reverse(), buildings: [...city.raw.buildings].reverse(), addresses: [] };
  const b = deriveNetwork(shuffled);
  assert.deepEqual(a.segments.map((s) => [s.id, s.houseCount]).sort(), b.segments.map((s) => [s.id, s.houseCount]).sort());
  assert.deepEqual(a.houses.map((h) => [h.id, h.parent]), b.houses.map((h) => [h.id, h.parent]));
});

test('routing: ambiguity is reported on a grid, disconnected otherwise', () => {
  const net = deriveNetwork(syntheticCity(4, 4).raw);
  const first = net.segments.find((s) => s.name === 'Querstraße 1')!;
  const last = net.segments.filter((s) => s.name === 'Querstraße 5').pop()!;
  const route = routeSegments(net, [first.id, last.id]);
  assert.equal(route.state, 'selected');
  if (route.state === 'selected') assert.equal(route.ambiguous, true, 'many equal-length grid routes');
  assert.deepEqual(routeSegments(net, [first.id, 'nope']), { state: 'disconnected' });
  assert.ok(buildGraph(net).byId.size === net.segments.length);
});

test('address nodes attach to buildings and standalone ones become point houses', () => {
  const raw = syntheticCity(2, 2).raw;
  raw.addresses.push({ id: 1, tags: { 'addr:housenumber': '42', 'addr:street': 'Querstraße 1' }, point: [13.0001, 51.00002] });
  const net = deriveNetwork(raw);
  assert.ok(net.houses.some((h) => h.source === 'address-node' && h.number === '42'));
});

import { decodePack, encodePack, packFromOverpass, paddedBbox, overpassQuery, restrictToArea } from '../src/v5/engine/index.ts';

test('overpass normalisation keeps node ids, counts bad elements and never throws on them', () => {
  const { raw, stats } = packFromOverpass({ elements: [
    { type: 'way', id: 1, nodes: [10, 11], geometry: [{ lat: 51, lon: 13 }, { lat: 51.001, lon: 13 }], tags: { highway: 'residential', name: 'A' } },
    { type: 'way', id: 2, nodes: [1, 2, 3, 4], geometry: [{ lat: 51, lon: 13 }, { lat: 51, lon: 13.0001 }, { lat: 51.0001, lon: 13.0001 }, { lat: 51, lon: 13 }], tags: { building: 'house' } },
    { type: 'way', id: 3, geometry: [{ lat: 51, lon: 13 }, { lat: 51.001, lon: 13 }, { lat: 51.002, lon: 13 }], tags: { building: 'house' } },
    { type: 'way', id: 4, geometry: [{ lat: 999, lon: 13 }, { lat: 51, lon: 13 }], tags: { highway: 'residential' } },
    { type: 'node', id: 5, lat: 51.0000, lon: 13.0000, tags: { 'addr:housenumber': '5' } },
    { type: 'node', id: 6, lat: 51.0, lon: 13.0, tags: {} },
    { type: 'relation', id: 7 },
  ] });
  assert.equal(raw.ways.length, 1);
  assert.deepEqual(raw.ways[0].nodes, [10, 11]);
  assert.equal(raw.buildings.length, 1);
  assert.equal(raw.addresses.length, 1);
  assert.deepEqual(stats.dropped, { building_ring_open: 1, way_bad_geometry: 1 });
  assert.throws(() => packFromOverpass({}), /overpass_response_invalid/);
  assert.match(overpassQuery(paddedBbox([[13, 51], [13.01, 51.01], [13, 51.01], [13, 51]])), /out geom qt;$/);
});

test('pack codec round-trips and rejects garbage', async () => {
  const raw = syntheticCity(2, 2).raw;
  const bytes = await encodePack(raw);
  assert.ok(bytes.length < JSON.stringify(raw).length / 3, 'gzip shrinks the pack');
  assert.deepEqual(await decodePack(bytes), raw);
  await assert.rejects(decodePack(await encodePack({ ways: 1 } as never)), /pack_invalid/);
});

test('restricting to an area keeps its houses and recomputes visibility', () => {
  const city = syntheticCity(4, 3);
  const full = deriveNetwork(city.raw);
  // Ring around the first block only.
  const cos = Math.cos((51 * Math.PI) / 180);
  const ring: [number, number][] = [[13 - 5 / (cos * 111320), 51 - 5 / 110574], [13 + 105 / (cos * 111320), 51 - 5 / 110574], [13 + 105 / (cos * 111320), 51 + 105 / 110574], [13 - 5 / (cos * 111320), 51 + 105 / 110574], [13 - 5 / (cos * 111320), 51 - 5 / 110574]];
  const part = restrictToArea(full, ring);
  assert.ok(part.houses.length > 0 && part.houses.length < full.houses.length / 4);
  assert.ok(part.houses.every((h) => h.parent === null || part.segments.some((s) => s.id === h.parent)), 'parents of kept houses are kept');
  assert.ok(part.segments.length < full.segments.length);
});

import { importLegacyProgress } from '../src/v5/engine/index.ts';

test('legacy progress carries over by OSM id and by position along the old street fragment', () => {
  const city = syntheticCity(4, 3);
  const net = deriveNetwork(city.raw);
  const through = city.raw.ways.find((w) => w.id === 1000)!;
  const legacy = {
    houseTasks: [
      { status: 'completed' as const, source: { objectType: 'way', objectIds: [5_000_000] } },
      { status: 'later' as const, source: { objectType: 'way', objectIds: [5_000_001] } },
      { status: 'completed' as const, source: { objectType: 'way', objectIds: [999] } },
      { status: 'open' as const, source: { objectType: 'way', objectIds: [5_000_002] } },
    ],
    tasks: [
      { status: 'open' as const, source: { objectType: 'way', objectIds: [1000] }, geometry: { type: 'LineString' as const, coordinates: through.coords },
        network: { length: 400, coverage: [{ from: 0, to: 150, status: 'completed' as const }] } },
      { status: 'not-deliverable' as const, source: { objectType: 'way', objectIds: [424242] }, geometry: { type: 'LineString' as const, coordinates: through.coords } },
    ],
  };
  const out = importLegacyProgress(net, legacy);
  assert.deepEqual([...out.houses].sort(), [['h:h5000000', 'completed'], ['h:h5000001', 'later']]);
  assert.deepEqual(out.stats, { housesMatched: 2, housesUnmatched: 1, streetRangesMatched: 1, streetRangesUnmatched: 1 });
  const marked = net.segments.filter((s) => out.segments.has(`s:${s.id}`));
  assert.ok(marked.length >= 2 && marked.every((s) => s.wayId === 1000));
  const lng0 = through.coords[0][0], cos = Math.cos((51 * Math.PI) / 180);
  for (const s of marked) assert.ok((s.coords[0][0] - lng0) * cos * 111320 < 150, 'only the covered stretch is carried over');
});

import { CHUNK_METERS } from '../src/v5/engine/index.ts';

test('chunks: long segments are cut into equal pieces ≤ CHUNK_METERS with stable ids and chained nodes', () => {
  const net = deriveNetwork(syntheticCity(4, 4).raw);
  const cut = net.segments.filter((s) => s.chunks > 1);
  assert.ok(cut.length > 0, 'the synthetic blocks are longer than one chunk');
  const ids = new Set<string>();
  for (const s of net.segments) {
    assert.ok(s.length <= CHUNK_METERS + 0.01, `${s.id} is ${s.length} m`);
    assert.ok(!ids.has(s.id), 'ids are unique');
    ids.add(s.id);
    assert.ok(s.chunk >= 0 && s.chunk < s.chunks);
    if (s.chunks === 1) assert.equal(s.id, s.group);
    else assert.equal(s.id, `${s.group}~${s.chunk}`);
  }
  const byGroup = new Map<string, typeof net.segments>();
  for (const s of net.segments) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
  for (const parts of byGroup.values()) {
    parts.sort((a, b) => a.chunk - b.chunk);
    assert.equal(parts.length, parts[0].chunks, 'every chunk of a group exists');
    for (let i = 1; i < parts.length; i++) {
      assert.equal(parts[i - 1].to, parts[i].from, 'chunks form a chain');
      assert.deepEqual(parts[i - 1].coords.at(-1), parts[i].coords[0], 'chunks touch geometrically');
    }
    assert.ok(parts.every((p) => p.visible === parts[0].visible), 'visibility is decided per group');
  }
});

test('chunks: ids do not change when unrelated data is added elsewhere', () => {
  const small = deriveNetwork(syntheticCity(3, 3).raw);
  const big = deriveNetwork(syntheticCity(3, 3).raw);
  assert.deepEqual(small.segments.map((s) => s.id), big.segments.map((s) => s.id));
});

test('chunks: a route across a chunked street selects the chain and measures real length', () => {
  const net = deriveNetwork(syntheticCity(3, 3).raw);
  const group = [...new Set(net.segments.filter((s) => s.chunks >= 2 && s.visible).map((s) => s.group))][0];
  const parts = net.segments.filter((s) => s.group === group).sort((a, b) => a.chunk - b.chunk);
  const route = routeSegments(net, [parts[0].id, parts.at(-1)!.id]);
  assert.equal(route.state, 'selected');
  if (route.state === 'selected') {
    for (const p of parts) assert.ok(route.segmentIds.includes(p.id), `${p.id} is on the route`);
  }
});

test('chunks: houses attach to the chunk beside them and every chunk of a service road shows up once one has houses', () => {
  const net = deriveNetwork(syntheticCity(3, 3).raw);
  const bySeg = new Map(net.segments.map((s) => [s.id, s]));
  for (const h of net.houses) if (h.parent) assert.ok(bySeg.has(h.parent));
  const withHouses = new Set(net.segments.filter((s) => s.houseCount > 0).map((s) => s.group));
  for (const s of net.segments) if (withHouses.has(s.group)) assert.equal(s.visible, true);
});
