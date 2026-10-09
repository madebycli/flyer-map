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
mod mvt;
mod session;
mod tile;

use model::{LngLat, Network, RawOsm};
use session::Session;
use std::sync::Mutex;

pub use derive::{CHUNK_METERS, ENGINE_VERSION};

static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// Snapshot of the Area added last, built only when the host asked for it (the full network is never kept twice).
static LAST_BLOB: Mutex<Option<Vec<u8>>> = Mutex::new(None);

fn with_session<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    let mut guard = SESSION.lock().unwrap();
    f(guard.get_or_insert_with(Session::new))
}

fn fail(message: &str) -> usize {
    store(format!("{{\"error\":{}}}", serde_json::to_string(message).unwrap_or_else(|_| "\"error\"".into())).into_bytes());
    0
}

fn merge_and_slim(network: Network, export: bool) -> usize {
    with_session(|s| s.add(&network));
    *LAST_BLOB.lock().unwrap() = if export { bincode::serialize(&network).ok() } else { None };
    match serde_json::to_vec(&session::slim(&network)) {
        Ok(bytes) => store(bytes),
        Err(e) => fail(&format!("serialize_failed: {e}")),
    }
}

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

/// New, empty session (drops every Area).
#[no_mangle]
pub extern "C" fn session_reset() {
    *SESSION.lock().unwrap() = Some(Session::new());
    *LAST_BLOB.lock().unwrap() = None;
}

/// Derive one Area from raw OSM JSON, merge it into the session and return its slim network JSON (0 = failure).
///
/// # Safety
/// Pointers/lengths come from `alloc` buffers written by the host.
#[no_mangle]
pub unsafe extern "C" fn session_add_area(raw_ptr: *const u8, raw_len: usize, ring_ptr: *const u8, ring_len: usize, export: u32) -> usize {
    let raw = match serde_json::from_slice::<RawOsm>(std::slice::from_raw_parts(raw_ptr, raw_len)) { Ok(r) => r, Err(e) => return fail(&format!("pack_invalid: {e}")) };
    let mut network = derive::derive_network(&raw);
    let ring: Vec<LngLat> = match serde_json::from_slice(std::slice::from_raw_parts(ring_ptr, ring_len)) { Ok(r) => r, Err(e) => return fail(&format!("ring_invalid: {e}")) };
    network = area::restrict_to_area(network, &ring);
    merge_and_slim(network, export != 0)
}

/// The full network of the Area added last, as a binary blob for the device cache (0 = nothing to export).
#[no_mangle]
pub extern "C" fn session_export_last() -> usize {
    match LAST_BLOB.lock().unwrap().take() {
        Some(bytes) => store(bytes),
        None => fail("nothing_to_export"),
    }
}

/// Load a cached Area blob (from `session_export_last`) into the session; returns its slim network JSON (0 = failure).
///
/// # Safety
/// Pointer/length come from an `alloc` buffer written by the host.
#[no_mangle]
pub unsafe extern "C" fn session_add_blob(ptr: *const u8, len: usize) -> usize {
    match bincode::deserialize::<Network>(std::slice::from_raw_parts(ptr, len)) {
        Ok(network) => merge_and_slim(network, false),
        Err(e) => fail(&format!("blob_invalid: {e}")),
    }
}

/// MVT bytes of tile z/x/y from everything in the session (length 0 = empty tile).
#[no_mangle]
pub extern "C" fn session_tile(z: u32, x: u32, y: u32) -> usize {
    store(with_session(|s| s.tile(z, x, y)))
}

/// Snap a point to the nearest house / street: JSON `{"position":[lng,lat],"address":string|null,"kind":0|1|2}`.
#[no_mangle]
pub extern "C" fn session_snap(lng: f64, lat: f64, house_reach: f64, street_reach: f64) -> usize {
    let (position, address, kind) = with_session(|s| s.snap([lng, lat], house_reach, street_reach));
    store(serde_json::to_vec(&serde_json::json!({ "position": position, "address": address, "kind": kind })).unwrap_or_default())
}

/// Route through street pieces: input is a JSON array of segment ids; output JSON
/// `{"state":"selected","segmentIds":[…],"length":m,"ambiguous":bool}` or `{"state":"disconnected"}`.
///
/// # Safety
/// Pointer/length come from an `alloc` buffer written by the host.
#[no_mangle]
pub unsafe extern "C" fn session_route(ptr: *const u8, len: usize) -> usize {
    let anchors: Vec<String> = match serde_json::from_slice(std::slice::from_raw_parts(ptr, len)) { Ok(a) => a, Err(e) => return fail(&format!("anchors_invalid: {e}")) };
    let out = with_session(|s| s.route(&anchors));
    let json = match out {
        session::RouteOut::Selected { ids, length, ambiguous } => serde_json::json!({ "state": "selected", "segmentIds": ids, "length": length, "ambiguous": ambiguous }),
        session::RouteOut::Disconnected => serde_json::json!({ "state": "disconnected" }),
    };
    store(serde_json::to_vec(&json).unwrap_or_default())
}
