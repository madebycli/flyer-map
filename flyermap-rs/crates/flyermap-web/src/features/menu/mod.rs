//! Menü: the way to everything that is not on the map.
pub mod rows;
pub mod sheet;

pub use rows::{menu_groups, MenuContext, MenuGroup, MenuRow, MenuTarget};
pub use sheet::{not_yet_text, MenuSheet};
