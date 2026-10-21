//! Which keys changed since the last look. The store remembers the status a key had when it was first touched; looking compares that with now, so
//! a change that was undone before anyone looked reports nothing.
use crate::{key::Key, overlay::Overlay, status::Status};
use std::collections::HashMap;

/// Keys whose status is different now, with the status they have now.
pub type Changes = HashMap<Key, Status>;

#[derive(Default, Debug)]
pub struct ChangeTracker {
    baseline: HashMap<Key, Status>,
}

impl ChangeTracker {
    /// Remember what `key` was before the first touch.
    pub fn touch(&mut self, key: &Key, before: Status) {
        self.baseline.entry(key.clone()).or_insert(before);
    }
    pub fn is_empty(&self) -> bool {
        self.baseline.is_empty()
    }
    pub fn take(&mut self, overlay: &Overlay) -> Changes {
        std::mem::take(&mut self.baseline)
            .into_iter()
            .filter_map(|(key, before)| {
                let now = overlay.status_of(&key);
                (now != before).then_some((key, now))
            })
            .collect()
    }
}
