//! Updates as a difference: when a Gebiet changed a little, a device that holds the old pack fetches a delta instead of the new pack.
mod apply;
mod diff;
mod file;
mod ranges;
mod script;

pub use apply::{apply, apply_to_payload};
pub use diff::{diff, REPLACE_ABOVE_PERCENT};
pub use file::{Delta, DELTA_PREFIX};
