//! The sync loop, without any I/O.
//!
//! [`Machine::handle`] takes an [`Event`] (a kick, a timer, an answer from the network) and returns the [`Action`]s the host must carry out (send a push,
//! ask for a page, start a timer, save the store, tell the interface). Nothing here waits, sleeps or fetches, so the whole loop, its retries and its
//! failures run in plain tests with a scripted server, and the browser driver is a thin loop around it.
//!
//! Failed pushes stay in the persisted outbox and are simply sent again: edits are idempotent and last-writer-wins, so there is no retry bookkeeping to get wrong.
pub mod action;
pub mod backoff;
pub mod event;
pub mod machine;
pub mod probe;
pub mod round;
mod steps;

pub use action::{Action, Save, SyncInfo};
pub use event::{Event, NetError, TimerKind};
pub use machine::{Config, Machine, State};
pub use round::{RoundResult, SyncRound};
