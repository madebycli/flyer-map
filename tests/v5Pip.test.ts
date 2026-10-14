import test from 'node:test';
import assert from 'node:assert/strict';
import { MARGIN, MIN_W, RATIO, clampBox, snapBox } from '../src/v5/app/pipBox.ts';

test('pip box: kept on the screen, never smaller than the minimum or wider than the screen allows', () => {
  const vw = 430, vh = 900;
  assert.deepEqual(clampBox({ x: -50, y: -50, w: 240 }, vw, vh), { x: MARGIN, y: MARGIN, w: 240 });
  const far = clampBox({ x: 9999, y: 9999, w: 240 }, vw, vh);
  assert.equal(far.x, vw - 240 - MARGIN); assert.equal(far.y, vh - 240 * RATIO - MARGIN);
  assert.equal(clampBox({ x: 20, y: 20, w: 10 }, vw, vh).w, MIN_W);
  assert.equal(clampBox({ x: 20, y: 20, w: 5000 }, vw, vh).w, vw - 2 * MARGIN);
  assert.equal(clampBox({ x: 20, y: 20, w: 5000 }, 1200, 800).w, 560, 'on a tablet it stops at a comfortable width');
});

test('pip box: it settles in the nearest corner', () => {
  const vw = 430, vh = 900, w = 200, h = w * RATIO;
  assert.deepEqual(snapBox({ x: 30, y: 60, w }, vw, vh), { x: MARGIN, y: MARGIN, w });
  assert.deepEqual(snapBox({ x: 300, y: 700, w }, vw, vh), { x: vw - w - MARGIN, y: vh - h - MARGIN, w });
  assert.deepEqual(snapBox({ x: 40, y: 600, w }, vw, vh), { x: MARGIN, y: vh - h - MARGIN, w });
});
