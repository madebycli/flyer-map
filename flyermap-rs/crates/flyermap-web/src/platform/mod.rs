//! Typed wrappers over the browser (`web-sys`): storage, theme, viewport, wake lock, vibration, the document, requests, IndexedDB, page events.
//! Nothing above this layer calls `web-sys` for these things; every function here fails quietly or with a typed error.
pub mod clipboard;
pub mod dom;
pub mod error;
pub mod events;
pub mod geo;
pub mod gunzip;
pub mod http;
pub mod http_error;
pub mod idb;
pub mod keyboard;
pub mod keys;
pub mod panic;
pub mod settings;
pub mod sound;
pub mod storage;
pub mod theme;
pub mod time;
pub mod vibrate;
pub mod viewport;
pub mod wake_lock;

pub use error::PlatformError;
pub use http_error::HttpError;
pub use settings::{Feedback, Hand, Settings};
pub use storage::{KeyValue, LocalStore};
pub use theme::Theme;
