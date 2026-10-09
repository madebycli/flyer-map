import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNetwork, slimNetwork } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { buildIndex } from '../src/v5/app/mark.ts';
import { ago, emptyTally, houseStats, percentOf } from '../src/v5/app/stats.ts';
import { buildSearchIndex, fold, searchEntries } from '../src/v5/app/search.ts';
import type { Status } from '../src/v5/store/types.ts';

const network = slimNetwork(deriveNetwork(syntheticCity(4, 3).raw));
const index = buildIndex(network);

test('percent counts houses, ignores "not possible" and never divides by zero', () => {
  assert.equal(percentOf(emptyTally()), 0);
  assert.equal(percentOf({ open: 1, completed: 1, later: 0, 'not-deliverable': 0 }), 50);
  assert.equal(percentOf({ open: 0, completed: 1, later: 0, 'not-deliverable': 9 }), 100);
  assert.equal(percentOf({ open: 3, completed: 0, later: 0, 'not-deliverable': 5 }), 0);
});

test('house stats are per area and add up to the overall tally', () => {
  const houses = network.houses;
  const half = new Set(houses.slice(0, Math.floor(houses.length / 2)).map((h) => `h:${h.id}`));
  const areaOf = new Map(houses.map((h, i) => [`h:${h.id}`, i % 2 ? 'a' : 'b']));
  const stats = houseStats(network, (key): Status => (half.has(key) ? 'completed' : 'open'), areaOf);
  assert.equal(stats.overall.completed, half.size);
  assert.equal(stats.overall.completed + stats.overall.open, houses.length);
  const sum = [...stats.byArea.values()].reduce((n, t) => n + t.completed + t.open, 0);
  assert.equal(sum, houses.length);
});

test('ago stays short and monotone', () => {
  assert.equal(ago(null, 1000), 'noch nie');
  assert.equal(ago(1000, 1000), 'gerade eben');
  assert.equal(ago(0, 30_000), 'vor 30 s');
  assert.equal(ago(0, 180_000), 'vor 3 min');
  assert.equal(ago(0, 7_200_000), 'vor 2 h');
});

test('folding ignores case, umlauts and Straße spellings', () => {
  assert.equal(fold('Große Straße'), 'grosse strasse');
  assert.equal(fold('Hauptstr. 4'), fold('Hauptstrasse 4'));
  assert.equal(fold('Müllerweg'), 'mullerweg');
});

test('search finds streets and house numbers, prefix and streets first', () => {
  const entries = buildSearchIndex(network);
  assert.ok(entries.some((e) => e.kind === 'street'));
  const house = network.houses.find((h) => h.street && h.number)!;
  const hit = searchEntries(entries, `${house.street} ${house.number}`);
  assert.ok(hit.some((e) => e.kind === 'house' && e.id === house.id));
  const street = searchEntries(entries, house.street!.slice(0, 4).toUpperCase());
  assert.ok(street.length > 0 && street.length <= 30);
  assert.equal(street[0].kind, 'street', 'a street outranks its own house numbers');
  assert.deepEqual(searchEntries(entries, '   '), []);
  assert.deepEqual(searchEntries(entries, 'zzzzqqq'), []);
});

test('the street entry points at a real segment', () => {
  for (const e of buildSearchIndex(network).filter((x) => x.kind === 'street')) assert.ok(index.segments.has(e.id));
});
