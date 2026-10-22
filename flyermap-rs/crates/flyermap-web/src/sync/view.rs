//! What the interface shows about the sync: the dot of the status pill and the box in the overview (same wording as the React app).
use crate::ui::SyncDot;
use flyermap_sync::State;

#[derive(Clone, Debug, PartialEq)]
pub struct SyncView {
    pub state: State,
    /// Queued edits not on the server yet.
    pub pending: usize,
    pub last_ok_at: Option<u64>,
    pub last_error: Option<String>,
}

impl Default for SyncView {
    fn default() -> SyncView {
        SyncView { state: State::Idle, pending: 0, last_ok_at: None, last_error: None }
    }
}

impl SyncView {
    /// Offline wins; anything queued or in flight is busy; otherwise everything is saved.
    pub fn dot(&self) -> SyncDot {
        match self.state {
            State::Offline => SyncDot::Offline,
            State::Syncing => SyncDot::Busy,
            State::Idle if self.pending > 0 => SyncDot::Busy,
            State::Idle => SyncDot::Ok,
        }
    }

    pub fn headline(&self) -> String {
        self.dot().title(self.pending as u32)
    }
}

/// "vor 12 s", "vor 3 min", "vor 2 h" (port of `ago` in `src/v5/app/stats.ts`).
pub fn ago(then: Option<u64>, now: u64) -> String {
    let Some(then) = then else { return "noch nie".into() };
    let s = (now.saturating_sub(then) as f64 / 1000.0).round() as u64;
    let round = |n: u64, d: u64| ((n as f64) / (d as f64)).round() as u64;
    match s {
        0..=4 => "gerade eben".into(),
        5..=59 => format!("vor {s} s"),
        60..=3599 => format!("vor {} min", round(s, 60)),
        3600..=86399 => format!("vor {} h", round(s, 3600)),
        _ => format!("vor {} d", round(s, 86400)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_follows_state_and_queue() {
        let mut v = SyncView::default();
        assert_eq!(v.dot(), SyncDot::Ok);
        v.pending = 2;
        assert_eq!((v.dot(), v.headline().as_str()), (SyncDot::Busy, "2 Änderungen werden gesendet"));
        v.state = State::Offline;
        assert_eq!(v.headline(), "Offline – 2 Änderungen warten");
    }

    #[test]
    fn ago_reads_like_the_overview() {
        assert_eq!(ago(None, 5), "noch nie");
        assert_eq!(ago(Some(1_000), 4_000), "gerade eben");
        assert_eq!(ago(Some(0), 12_000), "vor 12 s");
        assert_eq!(ago(Some(0), 125_000), "vor 2 min");
        assert_eq!(ago(Some(0), 7_300_000), "vor 2 h");
    }
}
