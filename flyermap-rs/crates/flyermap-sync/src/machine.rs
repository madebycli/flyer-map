use crate::{
    action::{Action, Save, SyncInfo},
    event::{Event, TimerKind},
    round::SyncRound,
};
use flyermap_core::Store;
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Idle,
    Syncing,
    Offline,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Syncing => "syncing",
            State::Offline => "offline",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    /// Edits per request.
    pub batch_size: usize,
    /// How long a local edit waits for company before a round starts.
    pub kick_delay_ms: u64,
    /// Whether a side channel (notes) rides the same loop.
    pub has_extras: bool,
    /// How many finished rounds are kept for the report.
    pub history: usize,
}

impl Default for Config {
    fn default() -> Config {
        Config { batch_size: 200, kick_delay_ms: 50, has_extras: false, history: 30 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Idle,
    Pushing,
    Pulling,
    Extras,
}

/// The loop. One per Aktion and device; the host owns it together with the store and feeds it events.
pub struct Machine {
    pub(crate) cfg: Config,
    pub(crate) state: State,
    pub(crate) phase: Phase,
    pub(crate) again: bool,
    pub(crate) disposed: bool,
    pub(crate) kick_timer: bool,
    pub(crate) retry_timer: bool,
    pub(crate) failures: u32,
    pub(crate) extra_failures: u32,
    pub(crate) extra_failed: bool,
    pub(crate) backoff_ms: u64,
    pub(crate) extras_pending: usize,
    pub(crate) round: SyncRound,
    pub(crate) round_started: u64,
    pub(crate) history: VecDeque<SyncRound>,
    pub(crate) last_ok_at: Option<u64>,
    pub(crate) last_error: Option<String>,
    pub(crate) last_error_code: Option<String>,
}

impl Machine {
    pub fn new(cfg: Config) -> Machine {
        Machine {
            cfg,
            state: State::Idle,
            phase: Phase::Idle,
            again: false,
            disposed: false,
            kick_timer: false,
            retry_timer: false,
            failures: 0,
            extra_failures: 0,
            extra_failed: false,
            backoff_ms: 0,
            extras_pending: 0,
            round: SyncRound::fresh(0),
            round_started: 0,
            history: VecDeque::new(),
            last_ok_at: None,
            last_error: None,
            last_error_code: None,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }
    pub fn info(&self) -> SyncInfo {
        SyncInfo { last_ok_at: self.last_ok_at, last_error: self.last_error.clone() }
    }
    pub fn history(&self) -> impl Iterator<Item = &SyncRound> {
        self.history.iter()
    }
    pub fn is_running(&self) -> bool {
        self.phase != Phase::Idle
    }
    /// How many notes (or other side-channel items) wait; shown next to the queued edits.
    pub fn set_extras_pending(&mut self, n: usize) {
        self.extras_pending = n;
    }

    /// The store was changed by the person: save what is due and ask for a round soon.
    pub fn after_local_edit(&mut self, store: &mut Store) -> Vec<Action> {
        let mut actions = self.saves(store);
        actions.extend(self.handle(store, 0, Event::Kick));
        actions
    }

    pub(crate) fn saves(&self, store: &mut Store) -> Vec<Action> {
        let dirty = store.take_dirty();
        let mut out = Vec::new();
        if dirty.outbox {
            out.push(Action::Save(Save::Outbox));
        }
        if dirty.overlay {
            out.push(Action::Save(Save::All));
        }
        out
    }

    pub(crate) fn notify(&self, store: &Store) -> Action {
        Action::Notify { state: self.state, pending: store.pending_len() + self.extras_pending, info: self.info() }
    }

    pub(crate) fn set_state(&mut self, state: State, store: &Store) -> Vec<Action> {
        if self.disposed {
            return Vec::new();
        }
        if state != self.state {
            flyermap_diag::diag!(flyermap_diag::Level::Debug, "sync", "state changed", from = self.state.as_str(), to = state.as_str());
        }
        self.state = state;
        flyermap_diag::gauge(
            "sync.state",
            match state {
                State::Idle => 0.0,
                State::Syncing => 1.0,
                State::Offline => 2.0,
            },
        );
        vec![self.notify(store)]
    }

    /// Feed one event; do what comes back. `now` is the device clock in ms.
    pub fn handle(&mut self, store: &mut Store, now: u64, event: Event) -> Vec<Action> {
        if self.disposed {
            return Vec::new();
        }
        match event {
            Event::Dispose => {
                self.disposed = true;
                vec![Action::CancelTimer(TimerKind::Kick), Action::CancelTimer(TimerKind::Retry)]
            }
            Event::Kick => {
                if self.kick_timer {
                    return Vec::new();
                }
                self.kick_timer = true;
                vec![Action::SetTimer { kind: TimerKind::Kick, after_ms: self.cfg.kick_delay_ms }]
            }
            Event::Timer(TimerKind::Kick) => {
                self.kick_timer = false;
                self.run(store, now)
            }
            Event::Timer(TimerKind::Retry) => {
                self.retry_timer = false;
                self.run(store, now)
            }
            Event::PushDone(result) => self.on_push(store, now, result),
            Event::PullDone(result) => self.on_pull(store, now, result),
            Event::ExtrasDone(result) => self.on_extras(store, now, result),
        }
    }

    fn run(&mut self, store: &mut Store, now: u64) -> Vec<Action> {
        if self.is_running() {
            self.again = true;
            return Vec::new();
        }
        self.start_cycle(store, now)
    }
}
