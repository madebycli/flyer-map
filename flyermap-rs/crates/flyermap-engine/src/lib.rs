//! Verteil-Flyer v5 engine: derive, tiles, route, lasso, search. A Rust library (`derive_restricted`, `Session`, ...) and, behind the `c-abi`
//! feature (on by default), a WebAssembly module with a C ABI and no wasm-bindgen (`abi.rs`).
//!
//! Protocol of the module (all buffers live in its linear memory):
//!   1. `alloc(len)` a buffer for the raw OSM JSON and one for the Area ring JSON (`[[lng,lat],…]`), write the bytes;
//!   2. `derive_area(raw_ptr, raw_len, ring_ptr, ring_len, cell_ptr, cell_len)` → number of result bytes (0 = failure; the message is the result);
//!   3. read `result_ptr()`/`result_len()` — UTF-8 JSON of `Network` (or `{"error":"…"}`), then `dealloc` every buffer.
#[cfg(feature = "c-abi")]
mod abi;
mod area;
mod classify;
mod derive;
mod geo;
mod grid;
pub mod model;
mod mvt;
mod query;
mod session;
mod tile;

use model::{LngLat, Network, RawOsm};

pub use derive::{CHUNK_METERS, ENGINE_VERSION};
/// The session and its answers, for hosts that link the engine as a library (the map-data pack loads a derived network straight into one).
pub use session::{slim, RouteOut, Session};

/// Phases exposed separately (benchmarks): parse, derive.
pub fn parse_raw(raw: &[u8]) -> Result<RawOsm, String> {
    serde_json::from_slice(raw).map_err(|e| format!("pack_invalid: {e}"))
}
pub fn derive_parsed(raw: &RawOsm) -> model::Network {
    derive::derive_network(raw)
}

/// Derive and cut to the Area in one step, as `derive_json` does, but hand over the `Network` itself: server-side packs need no JSON in between.
pub fn derive_restricted(raw: &RawOsm, ring: &[LngLat], cell: Option<[f64; 4]>) -> Network {
    area::restrict_to_area(derive::derive_network(raw), ring, cell)
}

/// Pure entry point (also used by the native tests): raw OSM JSON + optional ring JSON → Network JSON.
pub fn derive_json(raw: &[u8], ring: Option<&[u8]>, cell: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let raw: RawOsm = serde_json::from_slice(raw).map_err(|e| format!("pack_invalid: {e}"))?;
    let mut network = derive::derive_network(&raw);
    if let Some(ring) = ring {
        let ring: Vec<LngLat> = serde_json::from_slice(ring).map_err(|e| format!("ring_invalid: {e}"))?;
        let cell = parse_cell(cell)?;
        network = area::restrict_to_area(network, &ring, cell);
    }
    serde_json::to_vec(&network).map_err(|e| format!("serialize_failed: {e}"))
}

/// The optional grid cell of a part (`[west, south, east, north]` as JSON); empty = the whole Area.
pub(crate) fn parse_cell(cell: Option<&[u8]>) -> Result<Option<[f64; 4]>, String> {
    match cell {
        None => Ok(None),
        Some([]) => Ok(None),
        Some(bytes) => serde_json::from_slice::<[f64; 4]>(bytes).map(Some).map_err(|e| format!("cell_invalid: {e}")),
    }
}
