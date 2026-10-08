//! Verteil-Flyer v5 engine as a WebAssembly module (C ABI, no wasm-bindgen).
//!
//! Protocol (all buffers live in the module's linear memory):
//!   1. `alloc(len)` a buffer for the raw OSM JSON and one for the Area ring JSON (`[[lng,lat],…]`), write the bytes;
//!   2. `derive_area(raw_ptr, raw_len, ring_ptr, ring_len)` → number of result bytes (0 = failure; the message is the result);
//!   3. read `result_ptr()`/`result_len()` — UTF-8 JSON of `Network` (or `{"error":"…"}`), then `dealloc` every buffer.
mod area;
mod classify;
mod derive;
mod geo;
mod grid;
pub mod model;

use model::{LngLat, RawOsm};
use std::sync::Mutex;

pub use derive::{CHUNK_METERS, ENGINE_VERSION};

static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

/// Phases exposed separately (benchmarks): parse, derive.
pub fn parse_raw(raw: &[u8]) -> Result<RawOsm, String> {
    serde_json::from_slice(raw).map_err(|e| format!("pack_invalid: {e}"))
}
pub fn derive_parsed(raw: &RawOsm) -> model::Network {
    derive::derive_network(raw)
}

/// Pure entry point (also used by the native tests): raw OSM JSON + optional ring JSON → Network JSON.
pub fn derive_json(raw: &[u8], ring: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let raw: RawOsm = serde_json::from_slice(raw).map_err(|e| format!("pack_invalid: {e}"))?;
    let mut network = derive::derive_network(&raw);
    if let Some(ring) = ring {
        let ring: Vec<LngLat> = serde_json::from_slice(ring).map_err(|e| format!("ring_invalid: {e}"))?;
        network = area::restrict_to_area(network, &ring);
    }
    serde_json::to_vec(&network).map_err(|e| format!("serialize_failed: {e}"))
}

fn store(bytes: Vec<u8>) -> usize {
    let n = bytes.len();
    *RESULT.lock().unwrap() = bytes;
    n
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `alloc(len)` and not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// # Safety
/// Both slices must be valid for their lengths (they were written by the host into buffers from `alloc`).
#[no_mangle]
pub unsafe extern "C" fn derive_area(raw_ptr: *const u8, raw_len: usize, ring_ptr: *const u8, ring_len: usize) -> usize {
    let raw = std::slice::from_raw_parts(raw_ptr, raw_len);
    let ring = if ring_len == 0 { None } else { Some(std::slice::from_raw_parts(ring_ptr, ring_len)) };
    match derive_json(raw, ring) {
        Ok(bytes) => store(bytes),
        Err(message) => {
            store(format!("{{\"error\":{}}}", serde_json::to_string(&message).unwrap_or_else(|_| "\"error\"".into())).into_bytes());
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.lock().unwrap().as_ptr()
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.lock().unwrap().len()
}

#[no_mangle]
pub extern "C" fn engine_version_len() -> usize {
    ENGINE_VERSION.len()
}

#[no_mangle]
pub extern "C" fn engine_version_ptr() -> *const u8 {
    ENGINE_VERSION.as_ptr()
}
