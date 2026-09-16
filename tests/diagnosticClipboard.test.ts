import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../src/diagnostics/clipboard.ts';

test('diagnostic copy keeps the synchronous selection path inside the click gesture', async () => {
  const calls: string[] = [];
  const result = await copyTextToClipboard('street-log', {
    clipboard: { writeText: async () => { calls.push('clipboard'); } },
    legacyCopy: (value) => { calls.push(`legacy:${value}`); return true; },
  });

  assert.deepEqual(result, { ok: true, method: 'exec-command' });
  assert.deepEqual(calls, ['legacy:street-log']);
});

test('diagnostic copy uses the Clipboard API when synchronous copy is unavailable', async () => {
  const writes: string[] = [];
  const result = await copyTextToClipboard('street-log', {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    legacyCopy: () => false,
  });

  assert.deepEqual(result, { ok: true, method: 'clipboard-api' });
  assert.deepEqual(writes, ['street-log']);
});

test('diagnostic copy reports failure instead of silently doing nothing', async () => {
  const result = await copyTextToClipboard('street-log', {
    clipboard: null,
    legacyCopy: () => false,
  });

  assert.deepEqual(result, { ok: false, method: 'failed' });
});
