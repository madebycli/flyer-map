import test from 'node:test';
import assert from 'node:assert/strict';
import { safeHttpsUrl, safeStyleUrl, v5OptionsFromEnv } from '../worker/v5/config.ts';

test('only https or same-origin style URLs are handed to clients', () => {
  assert.equal(safeStyleUrl('https://tiles.example/style.json'), 'https://tiles.example/style.json');
  assert.equal(safeStyleUrl('/tiles/style.json'), '/tiles/style.json');
  for (const bad of ['http://tiles.example/x', 'javascript:alert(1)', '//evil.example/x', 'data:text/plain,x', '', '   ', undefined]) assert.equal(safeStyleUrl(bad), undefined, String(bad));
});

test('env drives the basemap: custom, default, and "off"', () => {
  const custom = v5OptionsFromEnv({ V5_BASEMAP_DARK: 'https://a.example/dark', V5_BASEMAP_LIGHT: '/own/light.json' });
  assert.deepEqual(custom.basemap, { dark: 'https://a.example/dark', light: '/own/light.json' });
  const fallback = v5OptionsFromEnv({ V5_BASEMAP_DARK: 'http://insecure.example' });
  assert.match(fallback.basemap!.dark!, /^https:/u, 'an unusable value falls back to the default instead of leaking through');
  const off = v5OptionsFromEnv({ V5_BASEMAP_DARK: 'off', V5_BASEMAP_LIGHT: 'OFF' });
  assert.deepEqual(off.basemap, { dark: undefined, light: undefined });
});

test('the Overpass endpoint comes from the environment; "default" and junk are ignored', () => {
  assert.equal(v5OptionsFromEnv({ OSM_OVERPASS_URL: 'https://overpass.example/api/interpreter' }).overpassUrl, 'https://overpass.example/api/interpreter');
  assert.equal(v5OptionsFromEnv({ OSM_OVERPASS_URL: 'default' }).overpassUrl, undefined);
  assert.equal(v5OptionsFromEnv({ OSM_OVERPASS_URL: 'ftp://x' }).overpassUrl, undefined);
  assert.equal(v5OptionsFromEnv({ OSM_OVERPASS_URL: '/relative/path' }).overpassUrl, undefined, 'the Worker fetches it, so it must be absolute');
  assert.equal(safeHttpsUrl('https://o.example/api'), 'https://o.example/api');
  assert.equal(safeHttpsUrl('http://o.example'), undefined);
});
