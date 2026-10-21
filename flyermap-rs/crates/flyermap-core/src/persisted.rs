//! What survives a restart. The shape is the one the TypeScript store wrote (`version: 1`), so a device keeps its queued edits when it switches.
use crate::{clock::ClockState, key::Key, op::Op, overlay::Entry, store::Store};
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

impl Store {
    /// Start from what was saved. Queued edits are applied on top of the saved overlay: they survive even when the overlay record is older.
    pub fn restore(actor: impl Into<String>, saved: &Persisted) -> Store {
        let mut store = Store::new(actor);
        store.clock = ClockState {
            node: store.actor.clone(),
            ..saved.clock.clone()
        };
        store.cursor = saved.cursor;
        for (key, entry) in &saved.overlay {
            store.apply_entry(key, entry.clone());
        }
        for op in &saved.pending {
            store.outbox.insert(op.clone());
            store.apply_entry(
                &op.key,
                Entry {
                    status: op.status,
                    at: op.id.clone(),
                    by: op.by.clone(),
                },
            );
        }
        store
    }

    /// The state to save. An outbox-only snapshot (`with_overlay == false`) keeps the potentially large overlay out.
    pub fn snapshot(&self, with_overlay: bool) -> Persisted {
        let mut overlay: Vec<(Key, Entry)> = if with_overlay {
            self.overlay
                .iter()
                .map(|(k, e)| (k.clone(), e.clone()))
                .collect()
        } else {
            Vec::new()
        };
        overlay.sort_by(|a, b| a.0.cmp(&b.0));
        Persisted {
            version: PERSISTED_VERSION,
            clock: self.clock.clone(),
            overlay,
            pending: self.outbox.ops(),
            cursor: self.cursor,
        }
    }
}
