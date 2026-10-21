//! Being overwritten: someone else's newer edit replaced one of ours and the screen changed under the user's hands, so the person must be told.
use crate::{clock::OpId, key::Key, status::Status};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Conflict {
    pub key: Key,
    pub mine: Status,
    pub theirs: Status,
    pub by: String,
    pub at: OpId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mine {
    pub id: OpId,
    pub status: Status,
}

/// Which edit of ours is the current winner per key, and which of ours were lost to others (until dismissed).
#[derive(Default, Debug)]
pub struct Conflicts {
    mine: HashMap<Key, Mine>,
    list: Vec<Conflict>,
}

impl Conflicts {
    pub fn set_mine(&mut self, key: Key, id: OpId, status: Status) {
        self.mine.insert(key, Mine { id, status });
    }
    pub fn mine(&self, key: &Key) -> Option<&Mine> {
        self.mine.get(key)
    }
    pub fn forget_mine(&mut self, key: &Key) {
        self.mine.remove(key);
    }
    /// A remote op arrived for a key: if it is our own edit coming back, nothing happens; if it is newer than ours it replaces ours, and a
    /// real change of status is recorded. Returns true when it was our own echo.
    pub fn on_remote(&mut self, key: &Key, id: &OpId, status: Status, by: &str) -> bool {
        let Some(mine) = self.mine.get(key).cloned() else {
            return false;
        };
        if &mine.id == id {
            return true;
        }
        if id > &mine.id {
            self.mine.remove(key);
            if status != mine.status {
                self.list.push(Conflict {
                    key: key.clone(),
                    mine: mine.status,
                    theirs: status,
                    by: by.to_string(),
                    at: id.clone(),
                });
            }
        }
        false
    }
    pub fn pending(&self) -> &[Conflict] {
        &self.list
    }
    pub fn dismiss(&mut self, keys: Option<&[Key]>) {
        match keys {
            Some(keys) => self.list.retain(|c| !keys.contains(&c.key)),
            None => self.list.clear(),
        }
    }
    pub fn len(&self) -> usize {
        self.list.len()
    }
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }
}
