import test from 'node:test';
import assert from 'node:assert/strict';
import { keepAwake, tick } from '../src/pwa/device.ts';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;

test('a mark buzzes once, unless the person switched it off or the device cannot', () => {
  const calls: number[] = [];
  tick({ vibrate: (p: VibratePattern) => { calls.push(p as number); return true; } });
  assert.deepEqual(calls, [12]);
  store.set('vf-haptics', 'off');
  tick({ vibrate: () => { calls.push(1); return true; } });
  assert.equal(calls.length, 1);
  store.delete('vf-haptics');
  assert.doesNotThrow(() => tick({} as Navigator));
});

test('the screen lock is asked for when visible, asked for again after the tab comes back, and let go on stop', async () => {
  const listeners = new Set<() => void>();
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (_: string, cb: () => void) => void listeners.add(cb), removeEventListener: (_: string, cb: () => void) => void listeners.delete(cb) };
  let requests = 0, released = 0;
  const fire: (() => void)[] = [];
  const nav = { wakeLock: { request: async () => { requests++; return { release: async () => { released++; }, addEventListener: (_: 'release', cb: () => void) => void fire.push(cb) }; } } };
  const stop = keepAwake(nav, doc as unknown as Document);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests, 1);
  fire[0](); // the browser dropped it (tab hidden)
  for (const cb of listeners) cb();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests, 2);
  stop();
  assert.equal(released, 1);
  assert.equal(listeners.size, 0);
  assert.doesNotThrow(() => keepAwake({}, doc as unknown as Document)(), 'no wake lock in this browser: nothing happens');
});
