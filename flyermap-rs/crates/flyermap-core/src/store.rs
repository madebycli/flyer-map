//! The field store: the overlay plus everything needed to edit it from several devices without a server round trip.
//!
//! The store never reads the time, the network or the disk. The host passes `device_now` (milliseconds) into every call that needs it and
//! persists what [`Store::take_dirty`] says is stale, from [`Store::snapshot`]. That keeps the logic testable and the same in the browser and the Worker.
use crate::{
    changes::{ChangeTracker, Changes},
    clock::{encode_clock, receive, tick, ClockState, OpId},
    conflict::{Conflict, Conflicts},
    key::Key,
    op::Op,
    outbox::Outbox,
    overlay::{Entry, Overlay},
    status::Status,
};
use std::collections::HashSet;

pub use crate::check::Finding;

/// What changed that is worth saving: queued edits at once (an app kill must not lose them), the overlay later and in bulk.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Dirty {
    pub outbox: bool,
    pub overlay: bool,
}

pub struct Store {
    pub(crate) actor: String,
    pub(crate) clock: ClockState,
    /// Server time minus device time: a phone that is an hour off must not lose every edit race.
    pub(crate) clock_offset_ms: i64,
    pub(crate) cursor: u64,
    pub(crate) overlay: Overlay,
    pub(crate) outbox: Outbox,
    pub(crate) conflicts: Conflicts,
    pub(crate) tracker: ChangeTracker,
    pub(crate) dirty: Dirty,
}

impl Store {
    pub fn new(actor: impl Into<String>) -> Store {
        let actor = actor.into();
        Store {
            clock: ClockState {
                wall: 0,
                counter: 0,
                node: actor.clone(),
            },
            actor,
            clock_offset_ms: 0,
            cursor: 0,
            overlay: Overlay::default(),
            outbox: Outbox::default(),
            conflicts: Conflicts::default(),
            tracker: ChangeTracker::default(),
            dirty: Dirty::default(),
        }
    }

    pub fn actor(&self) -> &str {
        &self.actor
    }
    pub fn status_of(&self, key: &Key) -> Status {
        self.overlay.status_of(key)
    }
    pub fn entry(&self, key: &Key) -> Option<&Entry> {
        self.overlay.get(key)
    }
    pub fn len(&self) -> usize {
        self.overlay.len()
    }
    pub fn is_empty(&self) -> bool {
        self.overlay.is_empty()
    }
    pub fn cursor(&self) -> u64 {
        self.cursor
    }
    pub fn clock_offset_ms(&self) -> i64 {
        self.clock_offset_ms
    }
    pub fn entries(&self) -> impl Iterator<Item = (&Key, &Entry)> {
        self.overlay.iter()
    }
    pub fn pending_ops(&self) -> Vec<Op> {
        self.outbox.ops()
    }
    pub fn pending_len(&self) -> usize {
        self.outbox.len()
    }
    pub fn conflicts(&self) -> &[Conflict] {
        self.conflicts.pending()
    }

    fn now(&self, device_now: u64) -> u64 {
        device_now.saturating_add_signed(self.clock_offset_ms)
    }

    pub(crate) fn apply_entry(&mut self, key: &Key, entry: Entry) {
        if let Some(before) = self.overlay.apply(key, entry) {
            self.tracker.touch(key, before);
        }
    }

    /// A local edit. Returns the operations (so a caller can undo them). Keys that already have this status are skipped.
    pub fn set(
        &mut self,
        keys: &[Key],
        status: Status,
        device_now: u64,
        area_of: &dyn Fn(&Key) -> Option<String>,
    ) -> Vec<Op> {
        let mut ops = Vec::new();
        for key in keys {
            if self.overlay.status_of(key) == status && self.overlay.contains(key) {
                continue;
            }
            self.clock = tick(&self.clock, self.now(device_now));
            let id = encode_clock(&self.clock);
            let op = Op {
                id: id.clone(),
                key: key.clone(),
                status,
                by: self.actor.clone(),
                area: area_of(key),
            };
            self.apply_entry(
                key,
                Entry {
                    status,
                    at: id.clone(),
                    by: self.actor.clone(),
                },
            );
            self.outbox.insert(op.clone());
            self.conflicts.set_mine(key.clone(), id, status);
            ops.push(op);
        }
        if !ops.is_empty() {
            self.dirty = Dirty {
                outbox: true,
                overlay: true,
            };
        }
        ops
    }

    /// Operations from the server (ours come back among them). `cursor` advances the server position.
    pub fn receive(&mut self, ops: &[Op], cursor: Option<u64>, device_now: u64) {
        for op in ops {
            self.clock = receive(&self.clock, op.id.as_str(), self.now(device_now));
            self.conflicts.on_remote(&op.key, &op.id, op.status, &op.by);
            self.apply_entry(
                &op.key,
                Entry {
                    status: op.status,
                    at: op.id.clone(),
                    by: op.by.clone(),
                },
            );
            self.outbox.remove(&op.id);
        }
        if let Some(cursor) = cursor {
            self.cursor = self.cursor.max(cursor);
        }
        self.dirty.overlay = true;
    }

    /// The server refused these edits for good (forbidden area, foreign key, impossible clock): undo their local effect, so the screen shows what the
    /// server has instead of a status nobody else will ever see.
    pub fn rollback(&mut self, ids: &[OpId]) {
        for id in ids {
            let Some(op) = self.outbox.remove(id) else {
                continue;
            };
            if self.conflicts.mine(&op.key).is_some_and(|m| &m.id == id) {
                self.conflicts.forget_mine(&op.key);
            }
            let Some(entry) = self.overlay.get(&op.key) else {
                continue;
            };
            if &entry.at != id {
                continue; // a newer local edit supersedes it and is judged on its own
            }
            self.tracker.touch(&op.key, entry.status);
            self.overlay.remove(&op.key);
            // An older edit of ours for the same key may still be queued: it is what this device shows (and will send) again.
            if let Some(older) = self.outbox.latest_for(&op.key).cloned() {
                self.overlay.apply(
                    &op.key,
                    Entry {
                        status: older.status,
                        at: older.id.clone(),
                        by: older.by.clone(),
                    },
                );
                self.conflicts
                    .set_mine(op.key.clone(), older.id, older.status);
            }
        }
        self.dirty = Dirty {
            outbox: true,
            overlay: true,
        };
    }

    /// The server confirmed these operations; they leave the outbox.
    pub fn acknowledge(&mut self, ids: &[OpId]) {
        for id in ids {
            self.outbox.remove(id);
        }
        self.dirty = Dirty {
            outbox: true,
            overlay: true,
        };
    }

    /// After the derived network is known: stamp queued edits with their Area and drop edits whose entity no longer exists. Returns how many were dropped.
    pub fn reconcile_pending(
        &mut self,
        is_known: &dyn Fn(&Key) -> bool,
        area_of: &dyn Fn(&Key) -> Option<String>,
    ) -> usize {
        let dropped = self.outbox.retain_mut(|op| {
            if !is_known(&op.key) {
                return false;
            }
            if op.area.is_none() {
                op.area = area_of(&op.key);
            }
            true
        });
        if dropped > 0 {
            self.dirty.overlay = true;
        }
        dropped
    }

    /// After a clean-up on the server: drop overlay entries and queued edits of keys that no longer exist. Returns how many overlay entries were removed.
    pub fn forget(&mut self, keys: &[Key]) -> usize {
        let gone: HashSet<Key> = keys.iter().cloned().collect();
        let mut removed = 0;
        for key in &gone {
            if self.overlay.remove(key).is_some() {
                removed += 1;
                self.conflicts.forget_mine(key);
            }
        }
        self.outbox.remove_keys(&gone);
        if removed > 0 {
            self.dirty = Dirty {
                outbox: true,
                overlay: true,
            };
        }
        removed
    }

    /// Pull everything again from the start (idempotent: only newer entries win).
    pub fn rewind_cursor(&mut self) {
        self.cursor = 0;
        self.dirty.outbox = true;
    }

    /// Server time seen on a pull; keeps new edits ordered correctly even when this device's clock is off.
    pub fn sync_clock(&mut self, server_now: u64, device_now: u64) {
        self.clock_offset_ms = i64::try_from(server_now)
            .unwrap_or(i64::MAX)
            .saturating_sub(i64::try_from(device_now).unwrap_or(i64::MAX));
    }

    pub fn dismiss_conflicts(&mut self, keys: Option<&[Key]>) {
        self.conflicts.dismiss(keys);
    }

    /// The keys whose status is different since the last call, with their status now.
    pub fn take_changes(&mut self) -> Changes {
        self.tracker.take(&self.overlay)
    }

    /// What the host should save now (and forget that it asked).
    pub fn take_dirty(&mut self) -> Dirty {
        std::mem::take(&mut self.dirty)
    }
}
