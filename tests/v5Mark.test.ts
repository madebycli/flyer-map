import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNetwork, slimNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { buildIndex, keysForGroups, keysForSegments, keysForTouched, lassoSelect, nearestOpen, wholeStreet } from '../src/v5/app/mark.ts';

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

test('a street found by search is the whole street: all connected pieces of the name, not only one junction-to-junction piece', () => {
  const named = network.segments.filter((s) => s.visible && s.name);
  const byName = new Map<string, typeof named>();
  for (const s of named) byName.set(s.name!, [...(byName.get(s.name!) ?? []), s]);
  const [name, pieces] = [...byName].find(([, list]) => new Set(list.map((s) => s.group)).size > 1)!;
  const whole = wholeStreet(index, pieces[0]);
  const groups = new Set(whole.map((c) => c.group));
  assert.ok(groups.size > 1, `${name}: more than one junction piece`);
  assert.ok(whole.every((c) => c.name === name));
  const own = (index.chunksByGroup.get(pieces[0].group) ?? []).map((c) => c.id);
  assert.ok(own.every((id) => whole.some((c) => c.id === id)), 'the found piece is part of it');
});

test('two far apart streets with the same name stay two streets', () => {
  const lone = { ...network.segments.find((s) => s.visible && s.name)! };
  const far = { ...lone, id: 'far~0', group: 'far', chunk: 0, chunks: 1, from: 'f1', to: 'f2', start: [lone.start[0] + 1, lone.start[1] + 1] as [number, number], mid: [lone.mid[0] + 1, lone.mid[1] + 1] as [number, number] };
  const twin = buildIndex({ ...network, segments: [lone, far] });
  assert.deepEqual(wholeStreet(twin, lone).map((c) => c.id), (twin.chunksByGroup.get(lone.group) ?? []).map((c) => c.id));
});

test('the next open street is the nearest one with work left, skipping what is done and what is not mine', () => {
  const withHouses = network.segments.filter((s) => s.visible && s.name && (index.groupHouses.get(s.group) ?? 0) > 0);
  const here = withHouses[0];
  const done = new Set<string>();
  const status = (key: string) => (done.has(key) ? 'completed' : 'open');
  const first = nearestOpen(index, here.mid, status, () => true)!;
  assert.equal(first.group, here.group, 'standing on a street with work, that is the one');
  // finish it completely: street pieces and houses
  for (const c of index.chunksByGroup.get(here.group)!) { done.add(`s:${c.id}`); for (const h of index.housesBySegment.get(c.id) ?? []) done.add(`h:${h.id}`); }
  const next = nearestOpen(index, here.mid, status, () => true)!;
  assert.notEqual(next.group, here.group);
  assert.equal(nearestOpen(index, here.mid, status, (s) => s.group === here.group), null, 'only my places count');
  // a street whose pieces are done but one house is open still has work
  const only = index.chunksByGroup.get(here.group)!;
  const house = only.flatMap((c) => index.housesBySegment.get(c.id) ?? [])[0];
  if (house) { done.delete(`h:${house.id}`); assert.equal(nearestOpen(index, here.mid, status, (s) => s.group === here.group)?.group, here.group); }
});
