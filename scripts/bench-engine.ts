// node --experimental-transform-types scripts/bench-engine.ts [blocks]   (TypeScript reference vs Rust/WASM, same bytes in, Network out)
import { readFileSync } from 'node:fs';
import { deriveNetwork, restrictToArea, type RawOsm } from '../src/v5/engine/index.ts';
import { syntheticCity } from '../src/v5/engine/synthetic.ts';
import { WasmEngine } from '../src/v5/engine/wasm.ts';

const blocks = Number(process.argv[2] ?? 70);
const raw = syntheticCity(blocks, blocks).raw;
const bytes = new TextEncoder().encode(JSON.stringify(raw));
const ring: [number, number][] = [[12.99, 50.99], [13 + (blocks * 100 + 100) / 70053, 50.99], [13 + (blocks * 100 + 100) / 70053, 51 + (blocks * 100 + 100) / 110574], [12.99, 51 + (blocks * 100 + 100) / 110574], [12.99, 50.99]];
const engine = await WasmEngine.load(readFileSync(new URL('../src/v5/engine/wasm/engine.wasm', import.meta.url)));
const time = (fn: () => unknown) => { const t = performance.now(); const out = fn(); return [Math.round(performance.now() - t), out] as const; };
console.log(`${raw.buildings.length} buildings, ${raw.ways.length} ways, ${(bytes.length / 1e6).toFixed(1)} MB JSON`);
for (let run = 1; run <= 3; run++) {
  const [ts] = time(() => restrictToArea(deriveNetwork(JSON.parse(new TextDecoder().decode(bytes)) as RawOsm), ring));
  const [wasm, net] = time(() => engine.deriveArea(bytes, ring));
  console.log(`run ${run}: TypeScript ${ts} ms · Rust/WASM ${wasm} ms (incl. result parse) → ${(ts / wasm).toFixed(1)}× · ${(net as { houses: unknown[] }).houses.length} houses`);
}
