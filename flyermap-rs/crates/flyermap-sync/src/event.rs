use flyermap_core::Op;
use flyermap_wire::{PushResponse, StatePage};

/// A timer the machine asked for. The host starts it with `SetTimer` and reports `Event::Timer` when it fires.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TimerKind {
    /// Waits a moment after a local edit so that several edits go out together.
    Kick,
    /// Waits after a failure before the next try.
    Retry,
}

/// A failed request, reduced to what the loop needs: what to tell the person (German, short), and a code for the diagnostics (`403 cross_origin`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NetError {
    pub message: String,
    pub code: String,
}

impl NetError {
    pub fn new(message: &str, code: &str) -> NetError {
        NetError { message: message.to_string(), code: code.to_string() }
    }
}

#[derive(Clone, Debug)]
pub enum Event {
    /// Something wants a round soon: a local edit, the window coming back, the person asking.
    Kick,
    Timer(TimerKind),
    PushDone(Result<PushResponse, NetError>),
    PullDone(Result<StatePage, NetError>),
    /// A side channel (notes) finished its round.
    ExtrasDone(Result<(), NetError>),
    /// Stop for good: no more retries, no more callbacks.
    Dispose,
}

/// The outbound edits as `Op`s, for hosts that want to look at them (the machine builds the wire form itself).
pub type Pending = Vec<Op>;
