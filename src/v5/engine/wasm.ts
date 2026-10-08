import type { LngLat, Network } from './types.ts';

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  derive_area(rawPtr: number, rawLen: number, ringPtr: number, ringLen: number): number;
  result_ptr(): number;
  result_len(): number;
  engine_version_ptr(): number;
  engine_version_len(): number;
};

/**
 * The Rust engine (engine-rs) behind the same contract as `deriveNetwork` + `restrictToArea`: raw OSM JSON bytes and an Area
 * ring in, `Network` out. The TypeScript engine stays the reference; tests compare both on seeded cities.
 */
export class WasmEngine {
  private constructor(private readonly x: Exports) {}

  static async load(source: BufferSource | Response | Promise<Response>): Promise<WasmEngine> {
    const { instance } = typeof Response !== 'undefined' && (source instanceof Response || source instanceof Promise)
      ? await WebAssembly.instantiateStreaming(source as Response | Promise<Response>, {}).catch(async () => {
        // Servers that do not send application/wasm: fall back to buffered instantiation.
        const response = await source;
        return WebAssembly.instantiate(await response.arrayBuffer(), {});
      })
      : await WebAssembly.instantiate(source as BufferSource, {});
    return new WasmEngine(instance.exports as unknown as Exports);
  }

  get version(): string {
    const { memory, engine_version_ptr, engine_version_len } = this.x;
    return new TextDecoder().decode(new Uint8Array(memory.buffer, engine_version_ptr(), engine_version_len()));
  }

  private put(bytes: Uint8Array): number {
    const ptr = this.x.alloc(bytes.byteLength);
    // `alloc` may have grown the memory: take the buffer afterwards.
    new Uint8Array(this.x.memory.buffer, ptr, bytes.byteLength).set(bytes);
    return ptr;
  }

  /** `rawJson` is the decompressed pack (what `JSON.stringify(RawOsm)` produced); no JS parse of it is needed. */
  /** Milliseconds of the last call: Rust (parse + derive + serialise), UTF-8 decode, JSON.parse of the result. */
  lastTiming = { wasm: 0, decode: 0, parse: 0, bytes: 0 };

  deriveArea(rawJson: Uint8Array, ring: LngLat[] | null): Network {
    const ringBytes = ring ? new TextEncoder().encode(JSON.stringify(ring)) : new Uint8Array(0);
    const rawPtr = this.put(rawJson);
    const ringPtr = ringBytes.byteLength ? this.put(ringBytes) : 0;
    try {
      const t0 = performance.now();
      const ok = this.x.derive_area(rawPtr, rawJson.byteLength, ringPtr, ringBytes.byteLength);
      const t1 = performance.now();
      const out = new Uint8Array(this.x.memory.buffer, this.x.result_ptr(), this.x.result_len());
      const text = new TextDecoder().decode(out);
      const t2 = performance.now();
      if (ok === 0) throw new Error(`wasm_engine: ${(JSON.parse(text) as { error: string }).error}`);
      const network = JSON.parse(text) as Network;
      const t3 = performance.now();
      this.lastTiming = { wasm: Math.round(t1 - t0), decode: Math.round(t2 - t1), parse: Math.round(t3 - t2), bytes: out.byteLength };
      return network;
    } finally {
      this.x.dealloc(rawPtr, rawJson.byteLength);
      if (ringPtr) this.x.dealloc(ringPtr, ringBytes.byteLength);
    }
  }
}
