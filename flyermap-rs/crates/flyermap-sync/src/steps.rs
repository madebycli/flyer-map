//! The steps of one round: push the queue in batches, pull until nothing is new, run the side channels, finish or fail.
use crate::{
    action::Action,
    backoff,
    event::{NetError, TimerKind},
    machine::{Machine, Phase, State},
    round::RoundResult,
};
use flyermap_core::{OpId, Store};
use flyermap_diag::{count, diag, observe, Level};
use flyermap_wire::{PushResponse, StatePage, WireOp};

const RETRY_BASE_MS: u64 = 500;
const RETRY_CAP_MS: u64 = 30_000;
const EXTRAS_BASE_MS: u64 = 1_000;
const EXTRAS_CAP_MS: u64 = 60_000;

impl Machine {
    pub(crate) fn start_cycle(&mut self, store: &mut Store, now: u64) -> Vec<Action> {
        self.again = false;
        self.round = crate::round::SyncRound::fresh(now);
        self.round_started = now;
        let mut actions = self.set_state(State::Syncing, store);
        actions.extend(self.next_push_or_pull(store));
        actions
    }

    fn next_push_or_pull(&mut self, store: &Store) -> Vec<Action> {
        let queue = store.pending_ops();
        let batch: Vec<_> = queue.into_iter().take(self.cfg.batch_size).collect();
        // Edits without a known Gebiet cannot be authorised yet; they stay in the queue and do not block a pull.
        let sendable: Vec<WireOp> = batch.iter().filter_map(WireOp::from_op).collect();
        if sendable.is_empty() {
            return self.pull_from(store);
        }
        self.phase = Phase::Pushing;
        self.round.batches += 1;
        self.round.sent += batch.len();
        count("sync.push.batches", 1);
        count("sync.push.sent", batch.len() as u64);
        vec![Action::Push(sendable)]
    }

    fn pull_from(&mut self, store: &Store) -> Vec<Action> {
        self.phase = Phase::Pulling;
        vec![Action::Pull { since: store.cursor() }]
    }

    pub(crate) fn on_push(&mut self, store: &mut Store, now: u64, result: Result<PushResponse, NetError>) -> Vec<Action> {
        if self.phase != Phase::Pushing {
            return Vec::new();
        }
        let response = match result {
            Ok(response) => response,
            Err(error) => return self.fail(store, now, error),
        };
        let accepted: Vec<OpId> = response.accepted.iter().map(OpId::new).collect();
        let rejected: Vec<OpId> = response.rejected.iter().map(|r| OpId::new(r.id.as_str())).collect();
        self.round.accepted += accepted.len();
        self.round.rejected += rejected.len();
        count("sync.push.accepted", accepted.len() as u64);
        if !rejected.is_empty() {
            count("sync.push.rejected", rejected.len() as u64);
            diag!(Level::Warn, "sync", code "sync.push.rejected", "edits refused by the server", count = rejected.len(), refetch = response.wants_refetch());
        }
        if response.wants_refetch() {
            count("sync.refetch", 1);
        }
        // The push cursor must not advance the pull cursor: it would skip other clients' ops.
        store.acknowledge(&accepted);
        if !rejected.is_empty() {
            store.rollback(&rejected);
        }
        if response.wants_refetch() {
            store.rewind_cursor();
        }
        let mut actions = self.saves(store);
        if accepted.is_empty() && rejected.is_empty() {
            actions.extend(self.pull_from(store));
        } else {
            actions.extend(self.next_push_or_pull(store));
        }
        actions
    }

    pub(crate) fn on_pull(&mut self, store: &mut Store, now: u64, result: Result<StatePage, NetError>) -> Vec<Action> {
        if self.phase != Phase::Pulling {
            return Vec::new();
        }
        let page = match result {
            Ok(page) => page,
            Err(error) => return self.fail(store, now, error),
        };
        self.round.pages += 1;
        self.round.pulled += page.ops.len();
        count("sync.pull.pages", 1);
        count("sync.pull.ops", page.ops.len() as u64);
        store.sync_clock(page.server_now, now);
        let empty = page.ops.is_empty();
        let ops: Vec<_> = page.ops.into_iter().map(|o| o.into_op()).collect();
        store.receive(&ops, Some(page.cursor), now);
        let mut actions = self.saves(store);
        if empty || page.cursor == 0 {
            actions.extend(self.after_pull(store, now));
        } else {
            actions.extend(self.pull_from(store));
        }
        actions
    }

    fn after_pull(&mut self, store: &mut Store, now: u64) -> Vec<Action> {
        if self.cfg.has_extras {
            self.phase = Phase::Extras;
            return vec![Action::RunExtras];
        }
        self.finish_ok(store, now)
    }

    pub(crate) fn on_extras(&mut self, store: &mut Store, now: u64, result: Result<(), NetError>) -> Vec<Action> {
        if self.phase != Phase::Extras {
            return Vec::new();
        }
        if let Err(error) = result {
            // Notes ride the same loop but must not make the status sync look offline (or the reverse): isolate and retry.
            self.extra_failed = true;
            self.last_error = Some(format!("Notizen: {}", error.message));
            self.last_error_code = Some(format!("Notizen: {}", error.code));
            diag!(Level::Warn, "sync", code "sync.notes.failed", "notes sync failed", error = error.code.as_str());
        }
        self.finish_ok(store, now)
    }

    fn finish_ok(&mut self, store: &mut Store, now: u64) -> Vec<Action> {
        let mut actions = Vec::new();
        if self.extra_failed {
            self.extra_failed = false;
            self.extra_failures += 1;
            self.backoff_ms = backoff::delay_ms(EXTRAS_BASE_MS, self.extra_failures, EXTRAS_CAP_MS);
            actions.extend(self.arm_retry());
        } else {
            self.extra_failures = 0;
            self.last_error = None;
            self.last_error_code = None;
            self.backoff_ms = 0;
        }
        if self.failures > 0 {
            diag!(Level::Info, "sync", "sync recovered");
        }
        self.failures = 0;
        self.last_ok_at = Some(now);
        flyermap_diag::gauge("sync.lastOkAt", now as f64);
        self.finish_round(now, if self.extra_failures > 0 { RoundResult::ExtrasFailed } else { RoundResult::Ok }, None);
        actions.extend(self.set_state(State::Idle, store));
        if self.again {
            actions.extend(self.start_cycle(store, now));
        } else {
            self.phase = Phase::Idle;
        }
        actions
    }

    fn fail(&mut self, store: &mut Store, now: u64, error: NetError) -> Vec<Action> {
        self.failures += 1;
        self.last_error = Some(error.message.clone());
        self.last_error_code = Some(error.code.clone());
        let mut actions = self.set_state(State::Offline, store);
        // Exponential backoff, capped; the queued edits stay safely in the persisted outbox.
        self.backoff_ms = backoff::delay_ms(RETRY_BASE_MS, self.failures, RETRY_CAP_MS);
        actions.extend(self.arm_retry());
        count("sync.failures", 1);
        diag!(Level::Warn, "sync", code "sync.failed", "sync failed, retrying", error = error.code.as_str(), failures = self.failures, retry_in_ms = self.backoff_ms, pending = store.pending_len());
        self.finish_round(now, RoundResult::Failed, Some(error.code));
        self.phase = Phase::Idle;
        actions
    }

    fn arm_retry(&mut self) -> Vec<Action> {
        self.retry_timer = true;
        vec![Action::CancelTimer(TimerKind::Retry), Action::SetTimer { kind: TimerKind::Retry, after_ms: self.backoff_ms }]
    }

    fn finish_round(&mut self, now: u64, result: RoundResult, error: Option<String>) {
        let mut round = std::mem::replace(&mut self.round, crate::round::SyncRound::fresh(now));
        round.ms = now.saturating_sub(self.round_started);
        round.result = result;
        round.error = error;
        count("sync.rounds", 1);
        count(&format!("sync.result.{}", result.as_str()), 1);
        observe("sync.round_ms", round.ms as f64);
        self.history.push_back(round);
        while self.history.len() > self.cfg.history {
            self.history.pop_front();
        }
    }
}
