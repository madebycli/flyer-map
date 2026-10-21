//! Invariants of the store: what must always be true. Tests call this after every step; the diagnostics report it.
use crate::{clock::OpId, store::Store};

/// A finding of [`Store::check`]: something that should never be true, with a stable code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub code: &'static str,
    pub detail: String,
}

impl Store {
    /// Invariants that must always hold. An empty answer means the store is consistent; tests call this after every step and the diagnostics report it.
    pub fn check(&self) -> Vec<Finding> {
        let mut findings = Vec::new();
        for op in self.outbox.ops() {
            if op.id.decode().is_none() {
                findings.push(Finding {
                    code: "outbox.bad_id",
                    detail: format!("queued edit {} has no valid timestamp", op.id),
                });
            }
            match self.overlay.get(&op.key) {
                Some(entry) if entry.at >= op.id => {}
                _ => findings.push(Finding {
                    code: "outbox.not_in_overlay",
                    detail: format!("queued edit {} is not reflected in the overlay", op.id),
                }),
            }
        }
        let behind = |at: &OpId| {
            at.decode()
                .is_some_and(|c| (c.wall, c.counter) > (self.clock.wall, self.clock.counter))
        };
        for (key, entry) in self.overlay.iter() {
            if entry.at.decode().is_none() {
                findings.push(Finding {
                    code: "overlay.bad_id",
                    detail: format!("{key} has no valid timestamp"),
                });
            } else if behind(&entry.at) {
                findings.push(Finding {
                    code: "clock.behind_overlay",
                    detail: format!("the clock is older than the edit on {key}"),
                });
            }
        }
        findings
    }
}
