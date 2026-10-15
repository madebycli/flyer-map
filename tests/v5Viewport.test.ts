import test from 'node:test';
import assert from 'node:assert/strict';

function fakePage(inner: number, vv: { height: number; offsetTop: number } | null) {
  const props = new Map<string, string>(); const attrs = new Set<string>();
  const listeners: Record<string, () => void> = {};
  (globalThis as Record<string, unknown>).document = { documentElement: { style: { setProperty: (k: string, v: string) => props.set(k, v) }, setAttribute: (k: string) => attrs.add(k), removeAttribute: (k: string) => attrs.delete(k) } };
  (globalThis as Record<string, unknown>).window = { innerHeight: inner, visualViewport: vv ? { ...vv, addEventListener: (t: string, f: () => void) => { listeners[t] = f; }, removeEventListener: () => {} } : undefined, addEventListener: () => {}, removeEventListener: () => {} };
  return { props, attrs, listeners, vv: (globalThis as { window: { visualViewport: { height: number } } }).window.visualViewport };
}

test('viewport: the keyboard is what covers the bottom of the page; data-kb is set only for a real keyboard', async () => {
  const { watchViewport } = await import('../src/v5/app/viewport.ts');
  const page = fakePage(800, { height: 460, offsetTop: 0 });
  const stop = watchViewport();
  assert.equal(page.props.get('--kb'), '340px'); assert.equal(page.props.get('--vvh'), '460px'); assert.ok(page.attrs.has('data-kb'));
  page.vv.height = 790; page.listeners.resize();
  assert.equal(page.props.get('--kb'), '10px', 'a small difference (a browser bar) is no keyboard'); assert.ok(!page.attrs.has('data-kb'));
  stop();
  const none = fakePage(800, null);
  watchViewport();
  assert.equal(none.props.get('--kb'), '0px'); assert.equal(none.props.get('--vvh'), '800px');
  const scrolled = fakePage(800, { height: 500, offsetTop: 100 });
  watchViewport();
  assert.equal(scrolled.props.get('--kb'), '200px', 'the page scrolled up by the keyboard: its offset counts');
});
