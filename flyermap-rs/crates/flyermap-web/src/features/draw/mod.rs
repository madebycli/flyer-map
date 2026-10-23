//! Gebiete zeichnen, the screens: the panel with its fixed places and the sheet that names the new Gebiet. The rules are `crate::drawing`, the wiring `app::draw`.
pub mod panel;
pub mod save_sheet;

pub use panel::{kind_icon, DrawPanel};
pub use save_sheet::{Choice, SaveSheet};
