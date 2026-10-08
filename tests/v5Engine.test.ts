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
