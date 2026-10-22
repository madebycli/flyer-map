//! Verteil-Flyer in the browser (Leptos, client-side rendering, WebAssembly). Layers, each only using the ones below it:
//!
//! - `platform`: typed wrappers over the browser (storage, theme, viewport, wake lock, vibration, tone, requests, IndexedDB);
//! - `model`: what the screens talk about as plain data: the world of an Aktion, the rights mirror, the subjects a tap can mean;
//! - `backend`: the one trait between the screens and the data, with the mock and the `/api/v5` bridge behind it;
//! - `engine`, `field`, `map`, `sync`: the street engine in its worker, the marking index, the MapLibre bridge, the host of the sync loop;
//! - `ui`: the design system (icons, buttons, rows, sheet, command bar, toast, card) and the palette;
//! - `shell`: what is open on the screen (sheet, tool, note), as one reducer;
//! - `session`: the running app behind the screens (backend, world, rights, progress, sync);
//! - `features`: the screens and the anchors (command bar, mode button, quick bar, live strip, sheets at the thing);
//! - `app`: state, zones, frame, effects, boot.
//!
//! The modules are public for the native tests in `tests/`; the browser entry is [`start`] (called by `main.rs` on wasm32).
pub mod app;
pub mod backend;
pub mod engine;
pub mod features;
pub mod field;
pub mod map;
pub mod model;
pub mod platform;
pub mod session;
pub mod shell;
pub mod sync;
pub mod ui;

pub use app::start;
