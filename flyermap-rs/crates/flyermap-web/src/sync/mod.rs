//! The host of the sync loop (`flyermap_sync::Machine`): requests, timers, saving in IndexedDB, page events, and what the interface shows.
pub mod host;
pub mod notes;
pub mod persist;
pub mod transport;
pub mod triggers;
pub mod view;

pub use host::SyncHost;
pub use view::{ago, SyncView};
