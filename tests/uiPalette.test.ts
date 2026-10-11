import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SEED, SEEDS, contrast, parseHex, schemeFor, toneColor } from '../src/ui/palette.ts';

const PAIRS: [string, string][] = [
  ['on', 'surface'], ['on', 'surface-4'], ['on-var', 'surface'], ['on-var', 'surface-2'],
  ['on-primary', 'primary'], ['on-primary-container', 'primary-container'],
  ['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'],
  ['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'],
  ['on-error', 'error'], ['on-error-container', 'error-container'],
  ['on-inverse', 'inverse'],
  ['primary', 'surface'], ['tertiary', 'surface'], ['error', 'surface'],
];

test('every seed gives readable text on its surfaces, containers and accents, in light and dark', () => {
  for (const seed of [...SEEDS.map((s) => s.hex), '#808080', '#ffff00', '#000000', '#ffffff', '#00aa00']) {
    for (const mode of ['dark', 'light'] as const) {
      const scheme = schemeFor(seed, mode);
      for (const [fg, bg] of PAIRS) {
        const ratio = contrast(scheme[fg], scheme[bg]);
        // text on containers and accents 4.5; the accent/tertiary/error colours on the plain surface are for icons, borders and large type: 3
        const needed = ['primary', 'tertiary', 'error'].includes(fg) && bg === 'surface' ? 3 : 4.5;
        assert.ok(ratio >= needed, `${seed} ${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${needed}`);
      }
    }
  }
});

test('tones are lightness: they rise in order and stay inside sRGB', () => {
  for (const hue of [0, 60, 120, 180, 240, 300]) {
    let last = -1;
    for (let tone = 0; tone <= 100; tone += 10) {
      const color = toneColor(hue, 0.14, tone);
      assert.match(color, /^#[0-9a-f]{6}$/);
      const y = (parseHex(color) as number[]).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
      assert.ok(y >= last - 1e-6, `hue ${hue}: tone ${tone} is darker than the one before`);
      last = y;
    }
  }
  assert.equal(toneColor(100, 0.1, 0), '#000000');
  assert.equal(toneColor(100, 0.1, 100), '#ffffff');
});

test('the seed colour decides the hue: different seeds give different accents, the neutrals stay quiet', () => {
  const green = schemeFor('#1f8a70', 'dark'), blue = schemeFor('#2f6bd8', 'dark');
  assert.notEqual(green.primary, blue.primary);
  assert.notEqual(green['primary-container'], blue['primary-container']);
  // a surface is nearly grey: its channels differ by little
  const [r, g, b] = (green.surface.slice(1).match(/../g) as string[]).map((x) => parseInt(x, 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 14, green.surface);
  assert.equal(schemeFor('not a colour', 'dark').primary, schemeFor(DEFAULT_SEED, 'dark').primary, 'an unusable seed falls back to the default');
});

test('the scheme names every token the stylesheet uses', () => {
  const dark = schemeFor(DEFAULT_SEED, 'dark'), light = schemeFor(DEFAULT_SEED, 'light');
  for (const name of ['surface', 'surface-1', 'surface-2', 'surface-3', 'surface-4', 'glass', 'on', 'on-var', 'outline', 'outline-var', 'primary', 'on-primary', 'primary-container', 'on-primary-container', 'tertiary', 'tertiary-container', 'on-tertiary-container', 'error', 'error-container', 'inverse', 'on-inverse']) {
    assert.ok(dark[name] && light[name], name);
  }
});
