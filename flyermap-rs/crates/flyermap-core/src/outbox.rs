//! Edits made here that the server has not confirmed yet. They survive a restart and are sent again until acknowledged or refused for good.
use crate::{clock::OpId, key::Key, op::Op};
use std::collections::BTreeMap;

#[derive(Default, Debug)]
pub struct Outbox {
    pending: BTreeMap<OpId, Op>,
}

impl Outbox {
    pub fn insert(&mut self, op: Op) {
        self.pending.insert(op.id.clone(), op);
    }
    pub fn get(&self, id: &OpId) -> Option<&Op> {
        self.pending.get(id)
    }
    pub fn remove(&mut self, id: &OpId) -> Option<Op> {
        self.pending.remove(id)
    }
    pub fn len(&self) -> usize {
        self.pending.len()
    }
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
    /// The newest queued edit of a key, if any.
    pub fn latest_for(&self, key: &Key) -> Option<&Op> {
        self.pending.values().rev().find(|op| &op.key == key)
    }
    /// Oldest first: the order they were made in.
    pub fn ops(&self) -> Vec<Op> {
        self.pending.values().cloned().collect()
    }
    /// Remove every queued op of these keys.
    pub fn remove_keys(&mut self, keys: &std::collections::HashSet<Key>) {
        self.pending.retain(|_, op| !keys.contains(&op.key));
    }
    /// Keep only ops for which `keep` says so; returns how many were dropped. `keep` may also fill in a missing area (the op is passed mutably).
    pub fn retain_mut(&mut self, mut keep: impl FnMut(&mut Op) -> bool) -> usize {
        let before = self.pending.len();
        self.pending.retain(|_, op| keep(op));
        before - self.pending.len()
    }
}
