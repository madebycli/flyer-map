import { restrictToArea } from './area.ts';
import { deriveNetwork } from './derive.ts';
import { networksToGeoJson, type MapGeoJson } from './geojson.ts';
import { decodePack, gunzip } from './pack.ts';
import { slimNetwork } from './slim.ts';
import { snapToNetworks, type SnapResult } from './snap.ts';
import type { FieldNetwork, LngLat, Network } from './types.ts';
import { WasmEngine } from './wasm.ts';

export type EngineKind = 'wasm' | 'ts';
export type AreaRequest = { areaId: string; ring: LngLat[]; pack?: Uint8Array; blob?: Uint8Array; wantBlob?: boolean };
export type AreaResult = { network: FieldNetwork; blob?: Uint8Array; ms: number; detail?: Record<string, number> };
export type MapData = { kind: 'tiles' } | ({ kind: 'geojson' } & MapGeoJson);

/**
 * The engine behind one campaign view: Rust/WASM when it can be loaded (geometry stays inside it and leaves as vector tiles),
 * the TypeScript reference otherwise (geometry leaves as GeoJSON). Runs in a Web Worker in the app and directly in tests.
 */
export class EngineHost {
  kind: EngineKind = 'ts';
  private wasm: WasmEngine | null = null;
  private fulls: Network[] = [];

  /** `loadWasm` returns the module bytes/response; omitted (or failing) means the TypeScript engine. */
  async init(loadWasm: (() => Parameters<typeof WasmEngine.load>[0]) | null): Promise<EngineKind> {
    this.wasm = null; this.fulls = []; this.kind = 'ts';
    if (loadWasm && typeof WebAssembly !== 'undefined') {
      try { this.wasm = await WasmEngine.load(loadWasm()); this.wasm.resetSession(); this.kind = 'wasm'; } catch { this.wasm = null; }
    }
    return this.kind;
  }

  stats(): { kind: EngineKind; wasmBytes: number; fulls: number } { return { kind: this.kind, wasmBytes: this.wasm?.memoryBytes() ?? 0, fulls: this.fulls.length }; }

  reset(): void { this.fulls = []; this.wasm?.resetSession(); }

  async area(req: AreaRequest): Promise<AreaResult> {
    const t0 = performance.now();
    if (this.wasm) {
      if (req.blob) {
        const network = this.wasm.addBlob(req.blob);
        const t = this.wasm.lastTiming;
        return { network, ms: Math.round(performance.now() - t0), detail: { blobWasm: t.wasm, blobParse: t.parse, blobBytes: t.bytes, blobIn: req.blob.byteLength } };
      }
      if (!req.pack) throw new Error('area_without_data');
      const raw = await gunzip(req.pack);
      const unzip = Math.round(performance.now() - t0);
      const network = this.wasm.addArea(raw, req.ring, !!req.wantBlob);
      const wasmMs = this.wasm.lastTiming;
      const blob = req.wantBlob ? this.wasm.exportLastArea() : undefined;
      return { network, blob, ms: Math.round(performance.now() - t0), detail: { gunzip: unzip, wasm: wasmMs.wasm, parse: wasmMs.parse, bytes: wasmMs.bytes } };
    }
    if (!req.pack) throw new Error('blob_needs_wasm');
    const full = restrictToArea(deriveNetwork(await decodePack(req.pack)), req.ring);
    this.fulls.push(full);
    return { network: slimNetwork(full), ms: Math.round(performance.now() - t0) };
  }

  mapData(): MapData { return this.wasm ? { kind: 'tiles' } : { kind: 'geojson', ...networksToGeoJson(this.fulls) }; }

  tile(z: number, x: number, y: number): Uint8Array { return this.wasm ? this.wasm.tile(z, x, y) : new Uint8Array(0); }

  snap(at: LngLat, houseReach = 30, streetReach = 22): SnapResult {
    return this.wasm ? this.wasm.snap(at[0], at[1], houseReach, streetReach) : snapToNetworks(this.fulls, at, houseReach, streetReach);
  }
}
