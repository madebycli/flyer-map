//! The contract between the app and the Worker. One definition, used by both sides.
//!
//! `error` (the error body and every code), `geometry` (outlines), `ops` and `state` (the sync), `meta` (what the app needs to boot).
//! More resources (notes, rooms, progress, packs, access) join as the Worker learns them; each gets its own module.
pub mod error;
pub mod geometry;
pub mod js_json;
pub mod meta;
pub mod ops;
pub mod state;

pub use error::{ApiError, ErrorCode, ErrorEnvelope};
pub use geometry::Polygon;
pub use ops::{PushRejected, PushRequest, PushResponse, WireOp};
pub use state::StatePage;
