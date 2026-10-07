import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSecretInventory } from '../scripts/validate-secret-inventory.mjs';

test('secret inventory distinguishes a verified empty list from an unavailable response', () => {
  assert.deepEqual(validateSecretInventory('200', { success: true, result: [] }), []);
  const entries = [{ name: 'EXISTING_KEY', type: 'secret_text' }];
  assert.equal(validateSecretInventory('200', { success: true, result: entries }), entries);
  for (const [status, response] of [
    ['503', { success: true, result: [] }], ['000', {}],
    ['200', { success: false, result: [] }], ['200', { success: true }],
    ['200', { success: true, result: [{}] }], ['200', null],
  ]) assert.throws(() => validateSecretInventory(status, response), /secret_inventory_unavailable/);
});

test('release inventory CLI fails closed on malformed JSON without logging its contents', t => {
  const directory = mkdtempSync(join(tmpdir(), 'secret-inventory-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const file = join(directory, 'response.json');
  writeFileSync(file, '{private fixture marker');
  const result = spawnSync(process.execPath, ['scripts/validate-secret-inventory.mjs', '200', file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Release stopped before preparing keys/);
  assert.doesNotMatch(result.stderr, /private fixture marker/);
  for (const workflow of ['beta-release.yml', 'release-channels.yml']) {
    const source = readFileSync(`.github/workflows/${workflow}`, 'utf8');
    assert.ok(source.indexOf('node scripts/validate-secret-inventory.mjs') < source.indexOf('crypto.randomBytes'));
    assert.doesNotMatch(source, /\{"success":true,"result":\[\]\}/);
  }
});
