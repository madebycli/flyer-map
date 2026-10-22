//! The floating bar of the top zone: menu, search with its results card, status pill.
pub mod bar;
pub mod cursor;
pub mod highlight;
pub mod hit;
pub mod pill;
pub mod results;

pub use bar::CommandBar;
pub use hit::{flat, Hit, HitKind, ResultGroup};
pub use pill::{PillState, StatusPill, SyncDot};
