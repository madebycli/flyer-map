/**
 * Golden vectors for `flyermap-pack`: what the TypeScript engine plans, asks Overpass and keeps from an answer.
 *   node --experimental-transform-types scripts/rs-vectors/pack.ts           (writes the file)
 *   node --experimental-transform-types scripts/rs-vectors/pack.ts --check   (fails when the file is stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { overpassQuery, packFromOverpass, packPlan, paddedBbox } from '../../src/v5/engine/overpass.ts';
import type { LngLat } from '../../src/v5/engine/types.ts';

const square = (lng: number, lat: number, dLng: number, dLat: number): LngLat[] => [[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]];
const rings: Record<string, LngLat[]> = {
  small: square(13.01, 51.0, 0.01, 0.01),
  edge: square(13.0, 51.0, 0.03, 0.02),
  big: square(12.98, 50.99, 0.07, 0.05),
  lshape: [[13.0, 51.0], [13.12, 51.0], [13.12, 51.03], [13.03, 51.03], [13.03, 51.08], [13.0, 51.08], [13.0, 51.0]],
  diagonal: [[13.0, 51.0], [13.2, 51.13], [13.19, 51.14], [12.99, 51.01], [13.0, 51.0]],
  south: square(-58.5, -34.7, 0.08, 0.06),
  west: square(-0.06, 51.47, 0.09, 0.04),
  huge: square(10.0, 50.0, 3.0, 2.0),
  runaway: square(-170.0, -60.0, 300.0, 120.0),
};
const plans = Object.entries(rings).map(([name, ring]) => ({ name, ring, plan: packPlan(ring), padded: paddedBbox(ring) }));
// toFixed(6) at exact ties (x/128 and friends round up in JavaScript, half-to-even elsewhere) and ordinary values.
const fixed = [0.0078125, -0.0078125, 13.0078125, 1.5, 0.1234565, 51.00000049999, -0.0000004, 179.9999995, 0, 2.5e-7];
const queries = [...fixed.map((x) => [x, x, x, x] as [number, number, number, number]), ...plans.flatMap((p) => p.plan.parts.slice(0, 3).map((part) => part.bbox))]
  .map((bbox) => ({ bbox, query: overpassQuery(bbox) }));

const answers: unknown[] = [
  { elements: [] },
  {
    elements: [
      { type: 'way', id: 1, tags: { highway: 'residential', name: 'Hauptstraße', 'x': 5 }, nodes: [10, 11, 12], geometry: [{ lat: 51.0, lon: 13.0 }, { lat: 51.001, lon: 13.001 }, { lat: '51.002', lon: 13.002 }] },
      { type: 'way', id: 2, tags: { highway: 'service' }, nodes: [10, 11], geometry: [{ lat: 51.0, lon: 13.0 }, { lat: 51.001, lon: 13.001 }, { lat: 51.002, lon: 13.003 }] },
      { type: 'way', id: 3, tags: { highway: 'path' }, geometry: [{ lat: 51.0, lon: 13.0 }] },
      { type: 'way', id: 4, tags: { highway: 'path' }, geometry: [{ lat: 91, lon: 13.0 }, { lat: 51, lon: 13 }] },
      { type: 'way', id: 5, tags: { building: 'yes', 'addr:street': 'Hauptstraße', 'addr:housenumber': '1' }, geometry: [{ lat: 51, lon: 13 }, { lat: 51, lon: 13.0001 }, { lat: 51.0001, lon: 13.0001 }, { lat: 51, lon: 13 }] },
      { type: 'way', id: 6, tags: { building: 'house' }, geometry: [{ lat: 51, lon: 13 }, { lat: 51, lon: 13.0001 }, { lat: 51.0001, lon: 13.0001 }, { lat: 51.0001, lon: 13 }] },
      { type: 'way', id: 7, tags: { building: 'yes' }, geometry: [{ lat: 51, lon: 13 }, { lat: 51, lon: 13.0001 }, { lat: 51, lon: 13 }] },
      { type: 'way', id: 8, tags: { landuse: 'grass' }, geometry: [{ lat: 51, lon: 13 }, { lat: 51, lon: 13.0001 }] },
      { type: 'way', id: 1, tags: { highway: 'primary', name: 'B 1' }, geometry: [{ lat: 51.0, lon: 13.0 }, { lat: 51.003, lon: 13.003 }] },
      { type: 'node', id: 20, lat: 51.0005, lon: 13.0005, tags: { 'addr:housenumber': '7a', 'addr:street': 'Hauptstraße', long: 'ä'.repeat(250) } },
      { type: 'node', id: 21, lat: 51.0005, lon: 13.0005, tags: { amenity: 'bench' } },
      { type: 'node', id: 22, lat: null, lon: 'x', tags: { 'addr:housenumber': '9' } },
      { type: 'node', id: 23, lat: '51.0006', lon: ' 13.0006 ', tags: { 'addr:housenumber': '' } },
      { type: 'node', id: 24, lat: 51.0007, lon: 13.0007, tags: ['addr:housenumber'] },
      { type: 'relation', id: 30, tags: { highway: 'pedestrian' } },
      { type: 'node', tags: { 'addr:housenumber': '1' } },
      { type: 'node', id: '25', lat: 51, lon: 13, tags: { 'addr:housenumber': '1' } },
      null,
      7,
      { type: 'way', id: 9.5, tags: { highway: 'track' }, geometry: [{ lat: 51, lon: 13 }, null] },
      { type: 'way', id: 10, tags: { highway: 'footway' }, nodes: [1, 2], geometry: [{ lat: 51, lon: 13 }, { lat: 51.0001, lon: 13.0001 }] },
    ],
  },
  { remark: 'runtime error', elements: [{ type: 'node', id: 1, lat: 51, lon: 13, tags: { 'addr:housenumber': '1' } }] },
  { version: 0.6 },
  null,
  [],
  { elements: [{ type: 'way', id: 11, tags: { highway: 'residential' }, geometry: 'nope' }] },
];
const normalized = answers.map((answer) => {
  try { return { answer, result: packFromOverpass(answer) }; } catch (error) { return { answer, error: (error as Error).message }; }
});

const file = new URL('../../flyermap-rs/crates/flyermap-pack/tests/vectors/pack.json', import.meta.url);
const text = `${JSON.stringify({ about: 'made by scripts/rs-vectors/pack.ts from the TypeScript engine; do not edit', plans, queries, normalized }, null, 1)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) { console.error('pack vectors are stale: run scripts/rs-vectors/pack.ts'); process.exit(1); }
  console.log('pack vectors up to date');
} else {
  writeFileSync(file, text);
  console.log(`wrote ${plans.length} plans, ${queries.length} queries, ${normalized.length} answers`);
}
