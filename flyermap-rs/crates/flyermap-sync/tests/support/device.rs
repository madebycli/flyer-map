//! A device: a store and a sync machine, and a driver that does what the actions ask against the in-memory server.
use super::server::{Fate, Server};
use flyermap_core::{Key, Op, Status, Store};
use flyermap_sync::{Action, Config, Event, Machine, NetError, Save, State, TimerKind};
use flyermap_wire::{PushRequest, WireOp};
use std::collections::BTreeMap;

pub struct Device {
    pub name: String,
    pub store: Store,
    pub machine: Machine,
    /// This device's own clock (it can be wrong).
    pub now: u64,
    pub saves: Vec<Save>,
    pub timers: Vec<(TimerKind, u64)>,
    pub notified: Vec<State>,
    /// What the network does with the next requests (front first); empty means deliver.
    pub fates: Vec<Fate>,
    pub fail_all: bool,
}

pub fn area_of(_: &Key) -> Option<String> {
    Some("a1".into())
}

impl Device {
    pub fn new(name: &str, now: u64) -> Device {
        Device {
            name: name.into(),
            store: Store::new(name),
            machine: Machine::new(Config {
                batch_size: 3,
                ..Config::default()
            }),
            now,
            saves: vec![],
            timers: vec![],
            notified: vec![],
            fates: vec![],
            fail_all: false,
        }
    }

    pub fn mark(&mut self, key: &str, status: Status) -> Vec<Op> {
        let ops = self.store.set(&[Key::new(key)], status, self.now, &area_of);
        let actions = self.machine.after_local_edit(&mut self.store);
        self.run(actions, &mut None);
        ops
    }

    /// Fire the kick timer if one is armed and drive the loop until it is idle or waiting on a timer.
    pub fn sync(&mut self, server: &mut Server) {
        let mut guard = 0;
        while let Some(i) = self.timers.iter().position(|(k, _)| *k == TimerKind::Kick) {
            self.timers.remove(i);
            let actions =
                self.machine
                    .handle(&mut self.store, self.now, Event::Timer(TimerKind::Kick));
            self.run(actions, &mut Some(server));
            guard += 1;
            assert!(guard < 50, "the loop does not settle");
        }
    }

    /// Something asks for a round (the window came back, a poll): kick and drive the loop.
    pub fn kick(&mut self, server: &mut Server) {
        let actions = self.machine.handle(&mut self.store, self.now, Event::Kick);
        self.run(actions, &mut Some(server));
        self.sync(server);
    }

    /// The retry timer fires (time has passed).
    pub fn retry(&mut self, server: &mut Server) {
        if let Some(i) = self.timers.iter().position(|(k, _)| *k == TimerKind::Retry) {
            self.timers.remove(i);
            let actions =
                self.machine
                    .handle(&mut self.store, self.now, Event::Timer(TimerKind::Retry));
            self.run(actions, &mut Some(server));
        }
        self.sync(server);
    }

    fn next_fate(&mut self) -> Fate {
        if self.fates.is_empty() {
            Fate::Deliver
        } else {
            self.fates.remove(0)
        }
    }

    fn run(&mut self, actions: Vec<Action>, server: &mut Option<&mut Server>) {
        let mut queue: std::collections::VecDeque<Action> = actions.into();
        while let Some(action) = queue.pop_front() {
            let event = match action {
                Action::Push(ops) => self.do_push(ops, server),
                Action::Pull { since } => self.do_pull(since, server),
                Action::RunExtras => Some(Event::ExtrasDone(Ok(()))),
                Action::SetTimer { kind, after_ms } => {
                    self.timers.retain(|(k, _)| *k != kind);
                    self.timers.push((kind, after_ms));
                    None
                }
                Action::CancelTimer(kind) => {
                    self.timers.retain(|(k, _)| *k != kind);
                    None
                }
                Action::Save(scope) => {
                    self.saves.push(scope);
                    None
                }
                Action::Notify { state, .. } => {
                    self.notified.push(state);
                    None
                }
            };
            if let Some(event) = event {
                queue.extend(self.machine.handle(&mut self.store, self.now, event));
            }
        }
    }

    fn do_push(&mut self, ops: Vec<WireOp>, server: &mut Option<&mut Server>) -> Option<Event> {
        let fate = self.next_fate();
        let Some(server) = server
            .as_deref_mut()
            .filter(|_| !self.fail_all && fate != Fate::Lost)
        else {
            return Some(Event::PushDone(Err(NetError::new(
                "Keine Verbindung",
                "offline",
            ))));
        };
        let response = server.push(&PushRequest { ops }, &self.name);
        if fate == Fate::LoseAnswer {
            return Some(Event::PushDone(Err(NetError::new(
                "Keine Verbindung",
                "offline",
            ))));
        }
        Some(Event::PushDone(Ok(response)))
    }

    fn do_pull(&mut self, since: u64, server: &mut Option<&mut Server>) -> Option<Event> {
        let fate = self.next_fate();
        let Some(server) = server
            .as_deref_mut()
            .filter(|_| !self.fail_all && fate != Fate::Lost)
        else {
            return Some(Event::PullDone(Err(NetError::new(
                "Keine Verbindung",
                "offline",
            ))));
        };
        Some(Event::PullDone(Ok(server.pull(since))))
    }

    pub fn view(&self) -> BTreeMap<String, Status> {
        self.store
            .entries()
            .map(|(k, e)| (k.to_string(), e.status))
            .collect()
    }
}
