//! The mock's stand-in for the server's log: edits get a running number, the same edit twice is stored once, an edit in a Gebiet the person may not
//! write in is refused for good. Pure, so the sync loop can be tried against it natively.
use flyermap_wire::{state::StateOp, PushRejected, PushResponse, StatePage, WireOp};
use std::collections::HashSet;

#[derive(Default)]
pub struct Log {
    ops: Vec<StateOp>,
    seen: HashSet<String>,
}

impl Log {
    /// `may_write(area)`: the rights of this person, mirrored.
    pub fn push(&mut self, ops: Vec<WireOp>, by: &str, may_write: &dyn Fn(&str) -> bool) -> PushResponse {
        let (mut accepted, mut rejected) = (Vec::new(), Vec::new());
        for op in ops {
            let id = op.id.as_str().to_string();
            if !may_write(&op.area) {
                rejected.push(PushRejected { id, reason: "area_forbidden".into() });
                continue;
            }
            if self.seen.insert(id.clone()) {
                self.ops.push(StateOp { id: op.id, key: op.key, status: op.status, by: by.to_string(), area: op.area });
            }
            accepted.push(id);
        }
        PushResponse { accepted, rejected }
    }

    /// Everything after the cursor, oldest first, at most `limit` rows.
    pub fn pull(&self, since: u64, limit: usize, server_now: u64) -> StatePage {
        let from = usize::try_from(since).unwrap_or(usize::MAX).min(self.ops.len());
        let to = (from + limit).min(self.ops.len());
        StatePage { ops: self.ops[from..to].to_vec(), cursor: to as u64, more: to < self.ops.len(), server_now }
    }

    pub fn len(&self) -> usize {
        self.ops.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::{Key, OpId, Status};

    fn op(id: &str, key: &str, area: &str) -> WireOp {
        WireOp { id: OpId::new(id), key: Key::new(key), status: Status::Completed, area: area.into() }
    }

    #[test]
    fn edits_get_numbers_duplicates_are_kept_once_and_forbidden_areas_refused() {
        let mut log = Log::default();
        let r = log.push(vec![op("a", "h:1", "ok"), op("b", "h:2", "no"), op("a", "h:1", "ok")], "x", &|area| area == "ok");
        assert_eq!((r.accepted.len(), r.rejected.len(), log.len()), (2, 1, 1), "the duplicate counts as accepted but is stored once");
        assert_eq!(r.rejected[0].reason, "area_forbidden");
        let page = log.pull(0, 10, 5);
        assert_eq!((page.ops.len(), page.cursor, page.more, page.server_now), (1, 1, false, 5));
    }

    #[test]
    fn pulling_pages_through_the_log() {
        let mut log = Log::default();
        log.push((0..5).map(|n| op(&format!("o{n}"), &format!("h:{n}"), "ok")).collect(), "x", &|_| true);
        let first = log.pull(0, 2, 0);
        assert_eq!((first.ops.len(), first.cursor, first.more), (2, 2, true));
        let last = log.pull(first.cursor, 10, 0);
        assert_eq!((last.ops.len(), last.cursor, last.more), (3, 5, false));
        assert!(log.pull(99, 10, 0).ops.is_empty());
    }
}
