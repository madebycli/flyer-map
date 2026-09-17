import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
  vars?: Record<string, string>;
};

const preparationSource = readFileSync(
  new URL('../worker/streetNetwork/preparation.ts', import.meta.url),
  'utf8',
);

test('Beta keeps the 2026-09-16 default cache key while blocking every live Overpass provider', () => {
  assert.equal(config.vars?.OSM_OVERPASS_URL, 'default');
  assert.equal(JSON.stringify(config.vars).includes('overpass.private.coffee'), false);
  assert.equal(JSON.stringify(config.vars).includes('maps.mail.ru'), false);

  // The restored 2026-09-16 runtime uses OSM_OVERPASS_URL as the source-cache key.
  // "default" therefore preserves the successful warm-cache path, but it is not
  // a valid URL. checkedOverpassUrl() rejects it before fetch() can be reached.
  assert.match(preparationSource, /const urls=\(options\.upstreamUrl \? \[options\.upstreamUrl\] : defaultOverpassUrls\(preferredDefaultUrl\)\)\.map\(checkedOverpassUrl\)/);
  assert.match(preparationSource, /const parsed=new URL\(url\)/);
});
