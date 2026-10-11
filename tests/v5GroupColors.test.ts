import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_COLORS, nextFreeColor } from '../src/v5/app/groupColors.ts';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('there are colours for twenty Gruppen and more, all different and all valid', () => {
  assert.ok(GROUP_COLORS.length >= 30, String(GROUP_COLORS.length));
  assert.equal(new Set(GROUP_COLORS.map((c) => c.toLowerCase())).size, GROUP_COLORS.length);
  for (const c of GROUP_COLORS) assert.match(c, /^#[0-9a-f]{6}$/);
  let nearest = Infinity;
  for (let i = 0; i < GROUP_COLORS.length; i++) for (let j = i + 1; j < GROUP_COLORS.length; j++) {
    const a = rgb(GROUP_COLORS[i]), b = rgb(GROUP_COLORS[j]);
    nearest = Math.min(nearest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  assert.ok(nearest >= 18, `two colours are only ${nearest.toFixed(1)} apart`);
});

test('a new Gruppe gets the first colour nobody uses; past the list a fresh one that is still unused', () => {
  assert.equal(nextFreeColor([]), GROUP_COLORS[0]);
  assert.equal(nextFreeColor([GROUP_COLORS[0], GROUP_COLORS[1]]), GROUP_COLORS[2]);
  assert.equal(nextFreeColor([GROUP_COLORS[0].toUpperCase()]), GROUP_COLORS[1], 'case does not matter');
  const all = [...GROUP_COLORS];
  const next = nextFreeColor(all);
  assert.ok(!all.includes(next));
  assert.match(next, /^#[0-9a-f]{6}$/);
});
