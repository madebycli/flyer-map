//! Typed wrappers over the browser (`web-sys`): storage, theme, viewport, wake lock, vibration, the document. Nothing above this layer calls
//! `web-sys` for these things; every function here fails quietly or with a [`PlatformError`].
pub mod dom;
pub mod error;
pub mod keys;
pub mod panic;
pub mod settings;
pub mod storage;
pub mod theme;
pub mod vibrate;
pub mod viewport;
pub mod wake_lock;

pub use error::PlatformError;
pub use settings::{Hand, Settings};
pub use storage::{KeyValue, LocalStore};
pub use theme::Theme;
