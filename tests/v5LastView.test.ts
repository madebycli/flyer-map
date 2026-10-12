import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestFirst } from '../src/v5/app/lastView.ts';

test('nearestFirst: the parts around the last view come first, ties keep their order, no view keeps the order', () => {
  const centers: ([number, number] | null)[] = [[13.5, 51], [13.0, 51], [13.02, 51.01], null, [13.0, 51]];
  assert.deepEqual(nearestFirst(centers, { center: [13.0, 51], zoom: 15 }), [1, 4, 2, 0, 3]);
  assert.deepEqual(nearestFirst(centers, null), [0, 1, 2, 3, 4]);
});
