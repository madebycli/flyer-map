//! The running app behind the screens: the backend, what it said ([`crate::model::World`], [`crate::model::Rights`]), the field (engine, network,
//! index), the progress, the map and, as the steps follow, the store and the sync. The screens read signals from here and call methods on it;
//! they never talk to a backend, an engine or the store directly.
pub mod core;
pub mod directory;
pub mod field;
pub mod progress;
pub mod store;

pub use self::core::{Phase, Session};
pub use field::{FieldState, Loaded};
pub use progress::Tracker;
pub use store::Applied;
