import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { buildIndex } from '../src/v5/app/mark.ts';
import { isPickupId, newPickupId, pickupTally, snapToNetwork, validateDraft } from '../src/v5/app/pickups.ts';

const net = deriveNetwork(syntheticCity(4, 3).raw);
const index = buildIndex(net);
const M = (x: number, y: number): [number, number] => [13 + x / 70053, 51 + y / 110574];
const area = { id: 'a', geometry: { type: 'Polygon' as const, coordinates: [[M(-300, -400), M(1500, -400), M(1500, 1500), M(-300, 1500), M(-300, -400)]] } };

test('a tap near a house snaps onto it and takes its address', () => {
  const house = [...index.houses.values()].find((h) => h.street && h.number)!;
  const near: [number, number] = [house.center[0] + 8 / 70053, house.center[1] + 5 / 110574];
  const snap = snapToNetwork(index, near, [area]);
  assert.equal(snap.snappedTo, 'house');
  assert.deepEqual(snap.position, house.center);
  assert.equal(snap.address, `${house.street} ${house.number}`);
  assert.equal(snap.areaId, 'a');
});

test('without a house in reach it snaps onto the street and uses its name', () => {
  const seg = [...index.segments.values()].find((s) => s.visible && s.name)!;
  const mid = seg.coords[Math.floor(seg.coords.length / 2)];
  const snap = snapToNetwork(index, [mid[0] + 3 / 70053, mid[1] + 3 / 110574], [area], 1, 22);
  assert.equal(snap.snappedTo, 'street');
  assert.equal(snap.address, seg.name);
  const metres = Math.hypot((snap.position[0] - mid[0]) * 70053, (snap.position[1] - mid[1]) * 110574);
  assert.ok(metres < 25, 'the snapped point lies on the street piece, not at the tap');
});

test('far from everything the tap stays where it is; outside every Area there is no Area', () => {
  const snap = snapToNetwork(index, M(5000, 5000), [area]);
  assert.deepEqual([snap.snappedTo, snap.address, snap.areaId], [null, null, null]);
  assert.deepEqual(snap.position, M(5000, 5000));
});

test('draft validation mirrors the server rules', () => {
  assert.deepEqual(validateDraft({ title: '  ', address: 'x', description: '' }), { ok: false, reason: 'title' });
  assert.deepEqual(validateDraft({ title: 'x', address: '', description: '' }), { ok: false, reason: 'address' });
  assert.deepEqual(validateDraft({ title: 'x'.repeat(161), address: 'a', description: '' }), { ok: false, reason: 'long' });
  const ok = validateDraft({ title: '  Kleider   Sack ', address: 'Weg  1', description: ' Tür hinten ' });
  assert.deepEqual(ok, { ok: true, value: { title: 'Kleider Sack', address: 'Weg 1', description: 'Tür hinten' } });
});

test('ids fit the server pattern and the tally only counts collected ones', () => {
  assert.ok(isPickupId(newPickupId()));
  assert.ok(!isPickupId('pickup_1'));
  const p = (status: 'open' | 'collected') => ({ id: 'x', areaId: null, title: '', address: '', description: '', position: [0, 0] as [number, number], status, updatedAt: '', archivedAt: null });
  assert.deepEqual(pickupTally([p('open'), p('collected'), p('collected')]), { total: 3, collected: 2 });
});
