use crate::event::TimerKind;
use flyermap_wire::WireOp;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Save {
    /// The queue and the clock only: small, and what an app kill must not lose. Do it now.
    Outbox,
    /// The overlay too: potentially large. Debounce it.
    All,
}

/// What the interface shows about the loop, next to the state.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SyncInfo {
    pub last_ok_at: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// `POST /ops` with these edits; answer with `Event::PushDone`.
    Push(Vec<WireOp>),
    /// `GET /state?since=…`; answer with `Event::PullDone`.
    Pull {
        since: u64,
    },
    /// Run the side channels (notes) and answer with `Event::ExtrasDone`.
    RunExtras,
    SetTimer {
        kind: TimerKind,
        after_ms: u64,
    },
    CancelTimer(TimerKind),
    Save(Save),
    /// The state changed: tell the interface (state, number of queued edits, info).
    Notify {
        state: crate::State,
        pending: usize,
        info: SyncInfo,
    },
}
