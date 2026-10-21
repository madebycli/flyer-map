//! What survives a restart. The shape is the one the TypeScript store wrote (`version: 1`), so a device keeps its queued edits when it switches.
use crate::{clock::ClockState, key::Key, op::Op, overlay::Entry};
use serde::{Deserialize, Serialize};

pub const PERSISTED_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Persisted {
    pub version: u8,
    pub clock: ClockState,
    /// May be empty in an outbox-only save; the host then keeps the overlay it saved earlier.
    pub overlay: Vec<(Key, Entry)>,
    pub pending: Vec<Op>,
    pub cursor: u64,
}
