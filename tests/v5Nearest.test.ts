import test from 'node:test';
import assert from 'node:assert/strict';
import { areaAt } from '../src/v5/areas/nearest.ts';
import type { LngLat } from '../src/v5/engine/types.ts';

const box = (x: number, y: number, size: number): LngLat[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const areas = [{ id: 'a', ring: box(13, 51, 0.01) }, { id: 'b', ring: box(13.02, 51, 0.01) }, { id: 'inner', ring: box(13.002, 51.002, 0.002) }];

test('the Area containing the position wins; of nested ones the closest centre', () => {
  assert.equal(areaAt(areas, [13.008, 51.008]), 'a');
  assert.equal(areaAt(areas, [13.0025, 51.0025]), 'inner');
  assert.equal(areaAt(areas, [13.025, 51.005]), 'b');
});

test('outside every Area: the nearest within reach, otherwise nothing', () => {
  assert.equal(areaAt(areas, [13.0149, 51.005]), 'a', 'between the two, a little closer to a');
  assert.equal(areaAt(areas, [13.011, 51.005], 1500), 'a');
  assert.equal(areaAt(areas, [14, 52]), null);
  assert.equal(areaAt([], [13, 51]), null);
});
