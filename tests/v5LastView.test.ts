import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestFirst } from '../src/v5/app/lastView.ts';

test('nearestFirst: the parts around the last view come first, ties keep their order, no view keeps the order', () => {
  const centers: ([number, number] | null)[] = [[13.5, 51], [13.0, 51], [13.02, 51.01], null, [13.0, 51]];
  assert.deepEqual(nearestFirst(centers, { center: [13.0, 51], zoom: 15 }), [1, 4, 2, 0, 3]);
  assert.deepEqual(nearestFirst(centers, null), [0, 1, 2, 3, 4]);
});

import { emptyTally, withServerProgress, type HouseStats } from '../src/v5/app/stats.ts';

test('withServerProgress: a Gebiet with parts missing takes its numbers from the server, only when the server knows all its units', () => {
  const local: HouseStats = { overall: { ...emptyTally(), open: 10, completed: 5 }, byArea: new Map([['a', { ...emptyTally(), open: 6, completed: 4 }], ['b', { ...emptyTally(), open: 4, completed: 1 }]]) };
  const server = { a: { houses: 100, units: 3, completed: 40, later: 5, notDeliverable: 5 }, b: { houses: 9, units: 1, completed: 9, later: 0, notDeliverable: 0 } };
  const merged = withServerProgress(local, server, new Set(['a', 'b']), new Map([['a', 3], ['b', 2]]));
  assert.deepEqual(merged.byArea.get('a'), { open: 50, completed: 40, later: 5, 'not-deliverable': 5 });
  assert.deepEqual(merged.byArea.get('b'), local.byArea.get('b'), 'the server knows only 1 of 2 units of b: the local numbers stay');
  assert.equal(merged.overall.completed, 5 - 4 + 40);
  assert.equal(withServerProgress(local, server, new Set(), new Map()), local, 'nothing partial: untouched');
});

import { coveredByServer } from '../src/v5/app/stats.ts';
import { grow, overlaps } from '../src/v5/app/lastView.ts';

test('coveredByServer: only when every unit of every partial Gebiet is known', () => {
  const server = { a: { houses: 5, units: 3, completed: 1, later: 0, notDeliverable: 0 }, b: { houses: 5, units: 1, completed: 1, later: 0, notDeliverable: 0 } };
  assert.equal(coveredByServer(server, new Set(['a']), new Map([['a', 3]])), true);
  assert.equal(coveredByServer(server, new Set(['a', 'b']), new Map([['a', 3], ['b', 2]])), false);
  assert.equal(coveredByServer(null, new Set(['a']), new Map()), false);
  assert.equal(coveredByServer(server, new Set(['c']), new Map([['c', 1]])), false);
});

test('view helpers: the view grows on every side and parts are found by overlap', () => {
  assert.deepEqual(grow([0, 0, 4, 2], 0.25), [-1, -0.5, 5, 2.5]);
  assert.equal(overlaps([0, 0, 1, 1], [1, 1, 2, 2]), true, 'touching counts');
  assert.equal(overlaps([0, 0, 1, 1], [1.1, 0, 2, 1]), false);
});
