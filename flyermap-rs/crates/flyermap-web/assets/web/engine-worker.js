// The street engine (flyermap-engine, its own WebAssembly module with a C ABI) off the main thread, for the Rust app (flyermap-web).
// This file only moves bytes between the app and the engine: it knows no engine function and no data shape. A request is
// { id, fn, args } with args numbers or Uint8Arrays (copied into engine memory as pointer + length); the reply is
// { id, n, bytes, ms }: the function's return value and, when it returned a number, the engine's result buffer.
'use strict';
let engine = null;
const ready = (async () => {
  const url = new URL('engine.wasm', self.location.href);
  let result;
  try { result = await WebAssembly.instantiateStreaming(fetch(url), {}); }
  catch { result = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), {}); } // a server without application/wasm
  engine = result.instance.exports;
  engine.session_reset();
})();

function run(fn, args) {
  const owned = [];
  const call = [];
  try {
    for (const arg of args) {
      if (arg instanceof Uint8Array) {
        const ptr = engine.alloc(arg.length);
        // alloc may have grown the memory: take the buffer afterwards
        new Uint8Array(engine.memory.buffer, ptr, arg.length).set(arg);
        owned.push([ptr, arg.length]);
        call.push(ptr, arg.length);
      } else call.push(arg);
    }
    const n = engine[fn](...call);
    if (typeof n !== 'number') return { n: 0, bytes: null };
    return { n, bytes: new Uint8Array(engine.memory.buffer, engine.result_ptr(), engine.result_len()).slice() };
  } finally {
    for (const [ptr, len] of owned) engine.dealloc(ptr, len);
  }
}

self.onmessage = async (event) => {
  const { id, fn, args } = event.data;
  try { await ready; } catch { self.postMessage({ id, error: 'engine_unavailable' }); return; }
  if (typeof engine[fn] !== 'function') { self.postMessage({ id, error: 'engine_no_function' }); return; }
  const t0 = performance.now();
  try {
    const { n, bytes } = run(fn, args);
    self.postMessage({ id, n, bytes, ms: performance.now() - t0 }, bytes ? [bytes.buffer] : []);
  } catch {
    self.postMessage({ id, error: 'engine_crashed' });
  }
};
