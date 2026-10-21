//! The pure domain of Verteil-Flyer. Everything here is a function of its inputs: time and identity are passed in, nothing is read from
//! the outside, so the same code runs in the browser and in the Worker and is tested natively.
//!
//! Layout: `status`, `key`, `clock`, `op` are the vocabulary; `overlay`, `outbox`, `conflict`, `changes` are the parts of the store;
//! `store` composes them and `persisted` is what survives a restart; `progress` counts houses and metres.
pub mod changes;
pub mod check;
pub mod clock;
pub mod conflict;
pub mod key;
pub mod note;
pub mod op;
pub mod outbox;
pub mod overlay;
pub mod persisted;
pub mod progress;
pub mod status;
pub mod store;

pub use changes::Changes;
pub use clock::{decode_clock, encode_clock, ClockState, OpId};
pub use conflict::Conflict;
pub use key::{EntityKind, Key};
pub use op::Op;
pub use overlay::Entry;
pub use persisted::Persisted;
pub use progress::{Progress, ProgressSnapshot};
pub use status::Status;
pub use store::{Dirty, Store};
