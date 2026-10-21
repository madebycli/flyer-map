/**
 * Golden vectors for the palette of `flyermap-web`: the Material You roles that `src/ui/palette.ts` (the oracle) computes for every offered seed,
 * a few other colours and a bad input, in both themes, plus single tones. The Rust test `tests/palette_vectors.rs` must produce the same hex codes.
 *   node --experimental-transform-types scripts/rs-vectors/palette.ts            writes the vector file
 *   node --experimental-transform-types scripts/rs-vectors/palette.ts --check    fails when the committed file is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SEEDS, schemeFor, toneColor } from '../../src/ui/palette.ts';

const FILE = new URL('../../flyermap-rs/crates/flyermap-web/tests/vectors/palette.json', import.meta.url);
const seeds = [...SEEDS.map((s) => s.hex), '#123456', '#ffffff', '#000000', '#808080', 'FF0000', 'nonsense'];
const schemes = seeds.flatMap((seed) => (['dark', 'light'] as const).map((mode) => ({ seed, mode, scheme: schemeFor(seed, mode) })));
const tones = [] as { hue: number; chroma: number; tone: number; hex: string }[];
for (const hue of [0, 29, 95.5, 180, 271.3]) for (const chroma of [0.008, 0.075, 0.2]) for (const tone of [0, 4, 10, 30, 50, 77, 99, 100]) tones.push({ hue, chroma, tone, hex: toneColor(hue, chroma, tone) });
const text = `${JSON.stringify({ schemes, tones }, null, 1)}\n`;

if (process.argv.includes('--check')) {
  const committed = readFileSync(FILE, 'utf8');
  if (committed !== text) { console.error('palette vectors are out of date: run scripts/rs-vectors/palette.ts'); process.exit(1); }
  console.log('palette vectors up to date');
} else {
  writeFileSync(FILE, text);
  console.log(`wrote ${schemes.length} schemes and ${tones.length} tones`);
}
