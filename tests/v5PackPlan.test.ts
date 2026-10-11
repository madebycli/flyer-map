import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PACK_PARTS, inCell, packAreaSquareKm, packPlan, type LngLat } from '../src/v5/engine/index.ts';

const square = (lng: number, lat: number, dLng: number, dLat: number): LngLat[] => [[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]];

test('a small Gebiet is one part without a cell (as before)', () => {
  const plan = packPlan(square(7.05, 50.8, 0.01, 0.008));
  assert.deepEqual([plan.single, plan.tooLarge, plan.parts.length, plan.parts[0].cell], [true, false, 1, null]);
});

test('a 600 km² Gebiet is a few hundred parts of a few km² each, every point of it in exactly one cell', () => {
  const ring = square(6.9, 50.6, 0.36, 0.2); // about 25 km × 22 km at 50.7° N
  assert.ok(packAreaSquareKm(ring) > 500, String(packAreaSquareKm(ring)));
  const plan = packPlan(ring);
  assert.equal(plan.single, false);
  assert.equal(plan.tooLarge, false);
  assert.ok(plan.parts.length >= 100 && plan.parts.length <= MAX_PACK_PARTS, String(plan.parts.length));
  assert.deepEqual(plan.parts.map((p) => p.index), plan.parts.map((_, i) => i), 'indices count up from 0');
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const point: LngLat = [6.9 + 0.36 * ((i * 37) % 400) / 400, 50.6 + 0.2 * ((i * 91) % 400) / 400];
    const owners = plan.parts.filter((p) => inCell(point, p.cell!));
    assert.equal(owners.length, 1, `point ${point} has ${owners.length} owners`);
    seen++;
  }
  assert.equal(seen, 400);
  for (const part of plan.parts) {
    assert.ok(part.bbox[0] < part.cell![1] && part.bbox[2] > part.cell![3] && part.bbox[1] < part.cell![0] && part.bbox[3] > part.cell![2], 'the query box has a margin around its cell');
  }
});

test('cells do not depend on the outline: editing the polygon keeps the cells it still covers', () => {
  const a = packPlan(square(6.9, 50.6, 0.3, 0.2));
  const b = packPlan(square(6.9, 50.6, 0.33, 0.2));
  const keyOf = (cell: number[]) => cell.join(',');
  const inA = new Set(a.parts.map((p) => keyOf(p.cell!)));
  const shared = b.parts.filter((p) => inA.has(keyOf(p.cell!))).length;
  assert.ok(shared >= a.parts.length * 0.9, `${shared} of ${a.parts.length}`);
});

test('an L-shaped Gebiet skips the cells it does not touch; a runaway outline is refused', () => {
  const lShape: LngLat[] = [[6.9, 50.6], [7.3, 50.6], [7.3, 50.64], [6.94, 50.64], [6.94, 50.9], [6.9, 50.9], [6.9, 50.6]];
  const box = packPlan(square(6.9, 50.6, 0.4, 0.3));
  const l = packPlan(lShape);
  assert.ok(l.parts.length < box.parts.length * 0.6, `${l.parts.length} vs ${box.parts.length}`);
  const huge = packPlan(square(0, 40, 20, 10));
  assert.deepEqual([huge.tooLarge, huge.parts.length], [true, 0]);
});
