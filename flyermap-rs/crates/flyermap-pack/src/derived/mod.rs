//! The derived pack: what the engine makes of a Gebiet's map data, once on the server, as bytes a device loads without deriving again.
//!
//! * `derive_pack` runs the engine and seals the network: head + gzip(`bincode(Network)`) (layout in `header`, check in `seal`).
//! * The name of a pack is the hash of its payload, `d/<hash>`: the bytes behind a name never change, so they are cached for ever.
//! * `verify` refuses anything damaged, cut, of another engine or of a newer format; `load_into` merges a pack into an engine session.
//! * `diff` / `apply` make an update a small delta when little changed; `manifest` lists the parts of a big Gebiet.
mod body;
mod delta;
mod error;
mod hash;
mod header;
mod load;
mod manifest;
mod pack;
mod seal;

pub use body::LEVEL as COMPRESSION_LEVEL;
pub use delta::{apply, apply_to_payload, diff, Delta, DELTA_PREFIX, REPLACE_ABOVE_PERCENT};
pub use error::DerivedError;
pub use header::{Counts, Header, Kind, FORMAT, HEADER_LEN, MAGIC};
pub use load::{load_into, load_network, Loaded};
pub use manifest::{manifest, Manifest, PartRef, MANIFEST_PREFIX};
pub use pack::{address, derive_pack, derive_pack_json, pack_network, DerivedPack, PACK_PREFIX};
pub use seal::verify;
