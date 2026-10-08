import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNetwork, slimNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { buildIndex, keysForGroups, keysForSegments, keysForTouched, lassoSelect } from '../src/v5/app/mark.ts';

const network = slimNetwork(deriveNetwork(syntheticCity(4, 3).raw));
const index = buildIndex(network);
const M = (x: number, y: number): [number, number] => [13 + x / 70053, 51 + y / 110574];

test('a street tap marks the segment and, on request, exactly its own houses', () => {
  const seg = network.segments.find((s) => s.visible && (index.housesBySegment.get(s.id)?.length ?? 0) > 0)!;
  const own = index.housesBySegment.get(seg.id)!;
  assert.deepEqual(keysForSegments(index, [seg.id], false), [`s:${seg.id}`]);
  const withHouses = keysForSegments(index, [seg.id], true);
  assert.equal(withHouses.length, 1 + own.length);
  assert.ok(own.every((h) => withHouses.includes(`h:${h.id}`)));
});

test('hidden connectors and unknown ids are never marked', () => {
  const hidden = network.segments.find((s) => !s.visible)!;
  assert.deepEqual(keysForSegments(index, [hidden.id, 'nope'], true), []);
});

test('painting dedupes: a house touched directly and via its street counts once', () => {
  const seg = network.segments.find((s) => s.visible && (index.housesBySegment.get(s.id)?.length ?? 0) > 0)!;
  const house = index.housesBySegment.get(seg.id)![0];
  const keys = keysForTouched(index, { houses: [house.id, house.id, 'ghost'], segments: [seg.id] }, true);
  assert.equal(keys.filter((k) => k === `h:${house.id}`).length, 1);
  assert.ok(!keys.includes('h:ghost'));
});

test('lasso selects houses by centre and streets by middle, nothing else', () => {
  // a box around the first block only (100 m x 100 m, with a small margin)
  const ring = [M(-5, -5), M(105, -5), M(105, 105), M(-5, 105), M(-5, -5)];
  const picked = lassoSelect(network, ring);
  const firstBlockHouses = network.houses.filter((h) => h.center[0] < M(105, 0)[0] && h.center[1] < M(0, 105)[1] && h.center[1] > M(0, -5)[1] && h.center[0] > M(-5, 0)[0]);
  assert.equal(picked.houses.length, firstBlockHouses.length);
  assert.ok(picked.houses.length > 0 && picked.houses.length < network.houses.length / 6);
  assert.ok(picked.segments.every((id) => index.segments.get(id)!.visible));
  assert.deepEqual(lassoSelect(network, [M(0, 0), M(1, 1)]), { houses: [], segments: [] }, 'fewer than three points select nothing');
});

test('a street tap covers every chunk of the junction segment and all their houses, other streets stay untouched', () => {
  const chunk = network.segments.find((s) => s.visible && s.chunks > 1)!;
  const group = network.segments.filter((s) => s.group === chunk.group);
  const keys = keysForGroups(index, [chunk.id], true);
  for (const part of group) assert.ok(keys.includes(`s:${part.id}`), `chunk ${part.id} is marked`);
  const houseKeys = group.flatMap((part) => (index.housesBySegment.get(part.id) ?? []).map((h) => `h:${h.id}`));
  for (const k of houseKeys) assert.ok(keys.includes(k));
  assert.equal(keys.length, group.length + houseKeys.length, 'nothing beyond the group and its houses');
  assert.deepEqual(keysForGroups(index, ['nope'], true), []);
  assert.deepEqual(keysForGroups(index, [chunk.id, group.at(-1)!.id], false).sort(), keysForGroups(index, [chunk.id], false).sort(), 'duplicates collapse');
});
