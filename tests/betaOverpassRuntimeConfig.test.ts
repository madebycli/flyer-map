import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
  vars?: Record<string, string>;
};

test('beta-compatible runtime config pins Street Engine to the primary Overpass provider', () => {
  assert.equal(config.vars?.OSM_OVERPASS_URL, 'https://overpass.private.coffee/api/interpreter');
  assert.equal(JSON.stringify(config.vars).includes('maps.mail.ru'), false);
});
