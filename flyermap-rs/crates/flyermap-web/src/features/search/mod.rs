//! Suche und Befehle: what the bar finds and what it can do. The searching itself is `flyermap-search` (one index over streets, houses, Gebiete, Gruppen,
//! people and commands); this module feeds it from the app's data (`entries`, `store`), asks it with the person's situation (`ask`) and keeps what was
//! picked lately (`recents`). The commands are data (`commands`).
pub mod ask;
pub mod commands;
pub mod entries;
pub mod recents;
pub mod store;

pub use ask::{ask, present, Situation};
pub use commands::{spec_of_key, Avail, CommandId};
pub use entries::{nearest_piece, target, Target};
pub use recents::Recents;
pub use store::SearchStore;
