//! The status overlay: the newest edit per key wins (last writer wins by clock). Applying is commutative, associative and idempotent,
//! so devices converge whatever the order or the number of deliveries.
use crate::{clock::OpId, key::Key, status::Status};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub status: Status,
    pub at: OpId,
    pub by: String,
}

#[derive(Default, Debug)]
pub struct Overlay {
    entries: HashMap<Key, Entry>,
}

impl Overlay {
    pub fn get(&self, key: &Key) -> Option<&Entry> {
        self.entries.get(key)
    }
    pub fn status_of(&self, key: &Key) -> Status {
        self.entries.get(key).map_or(Status::Open, |e| e.status)
    }
    pub fn contains(&self, key: &Key) -> bool {
        self.entries.contains_key(key)
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&Key, &Entry)> {
        self.entries.iter()
    }

    /// Apply one entry if it is newer than what is there. Returns the status the key had before when it changed anything.
    pub fn apply(&mut self, key: &Key, entry: Entry) -> Option<Status> {
        let before = self.status_of(key);
        match self.entries.get(key) {
            Some(existing) if existing.at >= entry.at => None,
            _ => {
                self.entries.insert(key.clone(), entry);
                Some(before)
            }
        }
    }

    pub fn remove(&mut self, key: &Key) -> Option<Entry> {
        self.entries.remove(key)
    }
}
