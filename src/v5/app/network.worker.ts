import { decodePack, deriveNetwork, gunzip, restrictToArea, WasmEngine, type Network } from '../engine/index.ts';

export type WorkerRequest = { areaId: string; pack: Uint8Array; ring: [number, number][] };
export type WorkerResponse = { areaId: string; network: Network; engine: 'wasm' | 'ts'; ms: number; detail?: Record<string, number> } | { areaId: string; error: string };

let wasm: Promise<WasmEngine | null> | null = null;
/** The Rust engine, loaded once per worker; null when WebAssembly or the module is unavailable (the TypeScript engine then does the work). */
function wasmEngine(): Promise<WasmEngine | null> {
  return (wasm ??= (typeof WebAssembly === 'undefined' ? Promise.resolve(null) : WasmEngine.load(fetch(new URL('../engine/wasm/engine.wasm', import.meta.url))).catch(() => null)));
}

/** Derivation is CPU work: keep it off the UI thread. Rust/WASM first, the TypeScript reference as the fallback. */
export async function derive(request: WorkerRequest): Promise<{ network: Network; engine: 'wasm' | 'ts'; ms: number; detail?: Record<string, number> }> {
  const t0 = performance.now();
  const engine = await wasmEngine();
  if (engine) {
    try {
      const raw = await gunzip(request.pack);
      const tUnzip = Math.round(performance.now() - t0);
      const network = engine.deriveArea(raw, request.ring);
      return { network, engine: 'wasm', ms: Math.round(performance.now() - t0), detail: { gunzip: tUnzip, ...engine.lastTiming } };
    } catch { /* fall through to the reference engine */ }
  }
  const network = restrictToArea(deriveNetwork(await decodePack(request.pack)), request.ring);
  return { network, engine: 'ts', ms: Math.round(performance.now() - t0) };
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof (self as { document?: unknown }).document === 'undefined') {
  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    try { (self as unknown as Worker).postMessage({ areaId: event.data.areaId, ...(await derive(event.data)) } satisfies WorkerResponse); }
    catch (error) { (self as unknown as Worker).postMessage({ areaId: event.data.areaId, error: error instanceof Error ? error.message : 'derive_failed' } satisfies WorkerResponse); }
  };
}
