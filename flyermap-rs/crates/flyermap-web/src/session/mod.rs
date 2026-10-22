//! The running app behind the screens: the backend, what it said ([`crate::model::World`], [`crate::model::Rights`]) and, as the steps follow, the
//! field (engine, network, map), the store and the sync. The screens read signals from here and call methods on it; they never talk to a
//! backend, an engine or the store directly.
pub mod core;

pub use self::core::{Phase, Session};
