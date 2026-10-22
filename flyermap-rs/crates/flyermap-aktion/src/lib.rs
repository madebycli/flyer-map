//! The Akteur of one Aktion (Plan 061 §1, §4, §5): the one writer of its state.
//!
//! A command comes in with the caller who sent it ([`Caller`]: a label and the grants the edge Worker loaded once for the request) and either happens
//! completely or not at all. What happens is a run of numbered entries in the log (`flyermap_protocol::Entry`); the tables are a function of the log
//! alone (`apply`), so a device that is told the entries it may see ends with the same state, in any order and any number of times.
//!
//! - [`Aktion`]: `handle` a command, `snapshot`, `marks_page`, `notes_page` and `catchup` for readers, `compact` the log.
//! - [`Audience`]: who of the connected devices may be told about an entry (the live feed): decided by `flyermap_identity::decide`, like everything.
//! - [`Sql`]: the narrow, synchronous storage. The Durable Object's SQL storage and `RusqliteSql` (feature `sqlite`, native) are its hosts; the Akteur
//!   itself does no I/O, has no clock (time comes in as `now`) and no randomness.
//!
//! Rights are asked in one place (`rights`), always as a question to `decide` about the thing as stored; no table has a column about who may see what and
//! no `WHERE` is a rights rule. Every figure the protocol bounds is checked here as well as on the device (`validate`, `Limits`).
mod aktion;
mod apply;
mod audience;
mod caller;
mod cmd;
mod config;
mod fail;
mod geometry;
mod out;
mod queries;
mod read;
mod rights;
mod schema;
pub mod sql;
#[cfg(feature = "sqlite")]
mod sqlite;
mod stats;
mod validate;
mod verify;

pub use aktion::{Aktion, Handled, OpenError};
pub use audience::Audience;
pub use caller::Caller;
pub use config::Limits;
pub use sql::{Row, Sql, SqlError, Value};
#[cfg(feature = "sqlite")]
pub use sqlite::RusqliteSql;
pub use verify::{Dump, ReplayError};
