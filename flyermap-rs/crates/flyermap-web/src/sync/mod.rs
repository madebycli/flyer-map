//! The host of the sync loop (`flyermap_sync::Machine`): requests through the [`crate::backend::Backend`], timers, saving in IndexedDB, page events,
//! and what the interface shows.
pub mod host;
pub mod persist;
pub mod triggers;
pub mod view;

pub use host::SyncHost;
pub use triggers::Triggers;
pub use view::{ago, SyncView};
