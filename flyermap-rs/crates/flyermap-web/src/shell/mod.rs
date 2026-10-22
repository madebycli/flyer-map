//! What is open on the screen, as plain data and one reducer: the sheet, the tool (marking, drawing), the note under the bar, the Studio's tab.
//! Pure, so every navigation rule is a native test; the app keeps it in one signal and renders the zones from it.
pub mod keys;
pub mod layout;
pub mod nav;

pub use keys::{shortcut, Screen, Shortcut};
pub use layout::{layout_for, Layout, WIDE_MIN_PX};
pub use nav::{Action, Notice, Panel, Shell, StudioTab, Tool};
