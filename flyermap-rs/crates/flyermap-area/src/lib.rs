//! Drawing Gebiete (Plan 057 §6.1). Coordinates are `[longitude, latitude]`; rings are closed like GeoJSON (first point repeated at the end).
//! Distances are metres in a local flat projection ([`frame`]), which is exact enough for the size of a town.
//!
//! - [`snap`]: where a finger lands on an existing border (a corner, or a point on an edge).
//! - [`connect`]: a stroke from a border back to the same border makes a new Gebiet that takes the old border between the two ends, or
//!   extends the old Gebiet by that piece.
//! - [`split`]: a stroke across a main area (Abholen) cuts it in two; one piece becomes a sub-area.
//! - [`check`]: a drawn outline is a valid Gebiet (closed, simple, big enough, not over another Gebiet).
//!
//! Shared borders get the very same corner points on both sides (the touched Gebiet is returned with the two ends inserted), so no slivers
//! or gaps appear between neighbours.
mod arc;
mod check;
mod connect;
mod error;
pub mod frame;
mod ring;
mod snap;
mod split;

pub use check::{check, MIN_AREA_M2};
pub use connect::{connect, Mode, Outcome};
pub use error::DrawError;
pub use ring::{area_m2, close, open};
pub use snap::{snap, BorderPoint, Snapped};
pub use split::split;

pub type LngLat = [f64; 2];
/// A closed ring: the first point is repeated at the end.
pub type Ring = Vec<LngLat>;
