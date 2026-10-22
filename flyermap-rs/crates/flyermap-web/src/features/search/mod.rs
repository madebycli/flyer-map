//! Suche und Befehle: what the bar finds and what it can do.
pub mod commands;
pub mod find;

pub use commands::{command, CommandId, COMMANDS};
pub use find::find;
