import assert from 'node:assert/strict';
import test from 'node:test';
import { setCoverage, type CoverageRange } from '../src/domain/streetNetwork.ts';
import type { TaskStatus } from '../src/domain/campaign.ts';

const TOTAL = 100;
const STATUSES: TaskStatus[] = ['open', 'completed', 'later', 'not-deliverable'];

function compressReference(cells: TaskStatus[]): CoverageRange[] {
  const result: CoverageRange[] = [];
  let start = 0;
  while (start < cells.length) {
    const status = cells[start];
    let end = start + 1;
    while (end < cells.length && cells[end] === status) end += 1;
    if (status !== 'open') result.push({ from: start, to: end, status });
    start = end;
  }
  return result;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('independent interval oracle preserves untouched work across randomized operations', () => {
  const seed = 0x5eed2026;
  const random = mulberry32(seed);
  const reference: TaskStatus[] = Array.from({ length: TOTAL }, () => 'open' as const);
  let actual: CoverageRange[] = [];

  for (let step = 0; step < 2_000; step += 1) {
    const a = Math.floor(random() * TOTAL);
    const b = Math.floor(random() * TOTAL);
    if (a === b) continue;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    const reverse = random() < 0.5;

    for (let index = from; index < to; index += 1) reference[index] = status;
    actual = setCoverage(actual, reverse ? to : from, reverse ? from : to, status, TOTAL);

    assert.deepEqual(
      actual,
      compressReference(reference),
      `seed=${seed} step=${step} operation=${reverse ? `${to}->${from}` : `${from}->${to}`} status=${status}`,
    );
  }
});
