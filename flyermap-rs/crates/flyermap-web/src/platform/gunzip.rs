//! Unpacking a gzip map pack with the browser's own `DecompressionStream` (native code, streamed, no inflate in our WebAssembly).
//! `DecompressionStream` is an unstable API in `web-sys`, so its constructor is declared here instead of a crate-wide `--cfg web_sys_unstable_apis`.
use wasm_bindgen::{prelude::wasm_bindgen, JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    type DecompressionStream;
    #[wasm_bindgen(constructor, catch)]
    fn new(format: &str) -> Result<DecompressionStream, JsValue>;
}

/// The unpacked bytes, or `None` when the browser cannot unpack or the data is no gzip.
pub async fn gunzip(packed: &js_sys::Uint8Array) -> Option<js_sys::Uint8Array> {
    let stream = DecompressionStream::new("gzip").ok()?;
    let body = web_sys::Response::new_with_opt_buffer_source(Some(packed)).ok()?.body()?;
    let pair: web_sys::ReadableWritablePair = stream.unchecked_into();
    let unpacked = web_sys::Response::new_with_opt_readable_stream(Some(&body.pipe_through(&pair))).ok()?;
    let buffer = JsFuture::from(unpacked.array_buffer().ok()?).await.ok()?;
    Some(js_sys::Uint8Array::new(&buffer))
}
