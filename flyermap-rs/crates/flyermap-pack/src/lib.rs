//! Map data of a Gebiet, from the plan to the stored bytes. Same results as `src/v5/engine/overpass.ts` and `pack.ts` (golden vectors in
//! `tests/vectors/pack.json`). No I/O: the Worker asks Overpass and writes the database. `derived` is the pack the engine's network makes once on the
//! server (content-addressed, binary, with deltas), so a device loads the finished network instead of deriving it.
pub mod derived;
mod encode;
mod js;
mod normalize;
mod plan;

pub use encode::{decode, encode};
pub use js::to_fixed;
pub use normalize::{normalize, Address, Building, NormalizeError, PackStats, RawOsm, Way};
pub use plan::{overpass_query, padded_bbox, plan, Bbox, Cell, LngLat, PackPart, PackPlan, MAX_PACK_PARTS};

/// The engine version a pack is built for; it must equal `flyermap_engine::ENGINE_VERSION` (checked by a test).
pub const ENGINE_VERSION: &str = "v5.6";
