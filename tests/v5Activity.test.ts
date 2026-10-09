import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveActivity, startOfDay } from '../src/v5/app/activity.ts';
import { encodeClock } from '../src/v5/store/hlc.ts';
import type { OverlayEntry, Status } from '../src/v5/store/types.ts';

const NOW = new Date(2026, 9, 9, 15, 0, 0).getTime();
const HOUR = 3_600_000, DAY = 24 * HOUR;
const entry = (status: Status, by: string, wall: number): OverlayEntry => ({ status, by, at: encodeClock({ wall, counter: 0, node: by }) });

test('activity counts houses per person for today, 7 days and in total', () => {
  const a = deriveActivity([
    ['h:1', entry('completed', 'Anna', NOW - HOUR)],
    ['h:2', entry('completed', 'Anna', NOW - 2 * DAY)],
    ['h:3', entry('completed', 'Anna', NOW - 9 * DAY)],
    ['h:4', entry('completed', 'Ben', NOW - 2 * HOUR)],
    ['h:5', entry('later', 'Ben', NOW - HOUR)],
    ['h:6', entry('not-deliverable', 'Ben', NOW - HOUR)],
  ], NOW);
  const anna = a.people.find((p) => p.name === 'Anna')!, ben = a.people.find((p) => p.name === 'Ben')!;
  assert.deepEqual([anna.completed, anna.today, anna.week], [3, 1, 2]);
  assert.deepEqual([ben.completed, ben.later, ben.blocked, ben.today], [1, 1, 1, 1]);
  assert.equal(a.todayTotal, 2);
  assert.equal(a.weekTotal, 3);
  assert.equal(a.people[0].name, 'Anna', 'most houses first');
});

test('streets show in the feed but never count toward the numbers', () => {
  const a = deriveActivity([['s:x~0', entry('completed', 'Anna', NOW - HOUR)], ['h:1', entry('completed', 'Anna', NOW - 2 * HOUR)]], NOW);
  assert.equal(a.people[0].completed, 1);
  assert.deepEqual(a.feed.map((f) => f.key), ['s:x~0', 'h:1'], 'newest first');
});

test('open places and entries without a readable time are ignored', () => {
  const a = deriveActivity([['h:1', entry('open', 'Anna', NOW)], ['h:2', { status: 'completed', by: 'Anna', at: 'garbage' }]], NOW);
  assert.equal(a.people.length, 0);
  assert.equal(a.feed.length, 0);
});

test('"today" is the local calendar day, not the last 24 hours', () => {
  const justBeforeMidnight = startOfDay(NOW) - 60_000;
  const a = deriveActivity([['h:1', entry('completed', 'Anna', justBeforeMidnight)], ['h:2', entry('completed', 'Anna', startOfDay(NOW) + 60_000)]], NOW);
  assert.equal(a.people[0].today, 1);
  assert.equal(a.people[0].week, 2);
});

test('the device id of local edits is folded into the person label (one row, not two)', () => {
  const a = deriveActivity([['h:1', entry('completed', 'dev-123', NOW - HOUR)], ['h:2', entry('completed', 'Anna', NOW - 2 * HOUR)]], NOW, 40, new Map([['dev-123', 'Anna']]));
  assert.equal(a.people.length, 1);
  assert.equal(a.people[0].completed, 2);
});

test('the feed is capped and ties are ordered by key', () => {
  const entries: [string, OverlayEntry][] = Array.from({ length: 100 }, (_, i) => [`h:${String(i).padStart(3, '0')}`, entry('completed', 'Anna', NOW - HOUR)]);
  const a = deriveActivity(entries, NOW, 10);
  assert.equal(a.feed.length, 10);
  assert.equal(a.feed[0].key, 'h:000');
  assert.equal(a.people[0].completed, 100);
});
