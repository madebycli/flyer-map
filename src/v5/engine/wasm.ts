import type { FieldNetwork, LngLat, Network } from './types.ts';

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  derive_area(rawPtr: number, rawLen: number, ringPtr: number, ringLen: number): number;
  result_ptr(): number;
  result_len(): number;
  engine_version_ptr(): number;
  engine_version_len(): number;
  session_reset(): void;
  session_add_area(rawPtr: number, rawLen: number, ringPtr: number, ringLen: number, exportBlob: number): number;
  session_export_last(): number;
  session_add_blob(ptr: number, len: number): number;
  session_tile(z: number, x: number, y: number): number;
  session_snap(lng: number, lat: number, houseReach: number, streetReach: number): number;
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

  // ── session: the engine keeps the geometry; the app gets coordinate-free data and tiles ──

  private result(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, this.x.result_ptr(), this.x.result_len());
  }

  private json<T>(n: number): T {
    const text = new TextDecoder().decode(this.result());
    if (n === 0) throw new Error(`wasm_engine: ${(JSON.parse(text) as { error: string }).error}`);
    return JSON.parse(text) as T;
  }

  private withBytes<T>(bytes: Uint8Array, fn: (ptr: number) => T): T {
    const ptr = this.put(bytes);
    try { return fn(ptr); } finally { this.x.dealloc(ptr, bytes.byteLength); }
  }

  /** Linear memory in bytes (it only ever grows): a steadily rising value across identical actions would be a leak. */
  memoryBytes(): number { return this.x.memory.buffer.byteLength; }

  resetSession(): void { this.x.session_reset(); }

  /** Derive one Area from the decompressed pack JSON, keep its geometry in the session, return the coordinate-free network. */
  addArea(rawJson: Uint8Array, ring: LngLat[], exportBlob = false): FieldNetwork {
    const ringBytes = new TextEncoder().encode(JSON.stringify(ring));
    return this.withBytes(rawJson, (rawPtr) => this.withBytes(ringBytes, (ringPtr) => {
      const t0 = performance.now();
      const n = this.x.session_add_area(rawPtr, rawJson.byteLength, ringPtr, ringBytes.byteLength, exportBlob ? 1 : 0);
      const t1 = performance.now();
      const network = this.json<FieldNetwork>(n);
      this.lastTiming = { wasm: Math.round(t1 - t0), decode: 0, parse: Math.round(performance.now() - t1), bytes: n };
      return network;
    }));
  }

  /** The last added Area as one binary blob for the device cache (geometry included); only after `addArea(…, true)`. */
  exportLastArea(): Uint8Array {
    const n = this.x.session_export_last();
    if (n === 0) this.json(0);
    return this.result().slice();
  }

  /** Re-load a cached Area blob; same effect as `addArea` without pack download or derivation. */
  addBlob(blob: Uint8Array): FieldNetwork {
    return this.withBytes(blob, (ptr) => {
      const t0 = performance.now();
      const n = this.x.session_add_blob(ptr, blob.byteLength);
      const t1 = performance.now();
      const network = this.json<FieldNetwork>(n);
      this.lastTiming = { wasm: Math.round(t1 - t0), decode: 0, parse: Math.round(performance.now() - t1), bytes: n };
      return network;
    });
  }

  /** MVT bytes of tile z/x/y (empty when there is nothing to draw). */
  tile(z: number, x: number, y: number): Uint8Array {
    this.x.session_tile(z, x, y);
    return this.result().slice();
  }

  /** Nearest house (within `houseReach` m) or street (within `streetReach` m) to a point. */
  snap(lng: number, lat: number, houseReach = 30, streetReach = 22): { position: LngLat; address: string | null; kind: 0 | 1 | 2 } {
    const n = this.x.session_snap(lng, lat, houseReach, streetReach);
    return this.json(n);
  }
}
