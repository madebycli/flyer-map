import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../src/diagnostics/clipboard.ts';

test('diagnostic copy uses the Clipboard API when available', async () => {
  const writes: string[] = [];
  const result = await copyTextToClipboard('street-log', {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    legacyCopy: () => { throw new Error('legacy path must not run'); },
  });

  assert.deepEqual(result, { ok: true, method: 'clipboard-api' });
  assert.deepEqual(writes, ['street-log']);
});

test('diagnostic copy falls back when Safari rejects Clipboard API writes', async () => {
  const fallbacks: string[] = [];
  const result = await copyTextToClipboard('street-log', {
    clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } },
    legacyCopy: (value) => { fallbacks.push(value); return true; },
  });

  assert.deepEqual(result, { ok: true, method: 'exec-command' });
  assert.deepEqual(fallbacks, ['street-log']);
});

test('diagnostic copy reports failure instead of silently doing nothing', async () => {
  const result = await copyTextToClipboard('street-log', {
    clipboard: null,
    legacyCopy: () => false,
  });

  assert.deepEqual(result, { ok: false, method: 'failed' });
});
