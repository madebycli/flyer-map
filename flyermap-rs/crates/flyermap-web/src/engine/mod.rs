//! The street engine (flyermap-engine) as the app sees it: a separate WebAssembly module in a Web Worker (`engine-worker.js` moves the bytes),
//! and typed calls on the main thread.
pub mod calls;
pub mod error;
pub mod network;
pub mod worker;

pub use calls::{status_code, Engine};
pub use error::EngineError;
pub use network::{Found, House, Lassoed, LngLat, Network, Route, Segment};
