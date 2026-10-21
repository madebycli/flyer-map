//! Verteil-Flyer in the browser (Leptos, client-side rendering, WebAssembly). Layers, each only using the ones below it:
//!
//! - `platform`: typed wrappers over the browser (storage, theme, viewport, wake lock, vibration);
//! - `ui`: the design system (icons, buttons, rows, switch, segmented choice, progress, sheet, command bar, toast, card) and the palette;
//! - `features`: the screens (menu, settings, colour, templates, overview, help, search, the map stand-in);
//! - `app`: state, navigation, effects, the frame.
//!
//! The modules are public for the native tests in `tests/`; the browser entry is [`start`] (called by `main.rs` on wasm32).
pub mod app;
pub mod features;
pub mod platform;
pub mod ui;

pub use app::start;
