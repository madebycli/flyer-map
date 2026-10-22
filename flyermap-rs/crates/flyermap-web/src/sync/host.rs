//! The browser driver of `flyermap_sync::Machine`: it feeds the machine events (kicks, timers, answers) and carries out what comes back
//! (requests, timers, saving, telling the interface). The decisions are all in the machine; this file only does the I/O.
use super::{notes::Notes, persist, transport, view::SyncView};
use crate::platform::time::now_ms;
use flyermap_core::{Changes, Store};
use flyermap_sync::{Action, Config, Event, Machine, NetError, Save, TimerKind};
use leptos::task::spawn_local;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};
use wasm_bindgen::{closure::Closure, JsCast};

/// The overlay (all statuses) is saved this long after the last change; queued edits are saved at once.
const SAVE_ALL_AFTER_MS: i32 = 1500;
/// Edits per push request (as the React app).
const BATCH: usize = 100;

pub struct Shared {
    campaign: String,
    base: String,
    pub store: Rc<RefCell<Store>>,
    machine: RefCell<Machine>,
    notes: RefCell<Notes>,
    timers: RefCell<HashMap<TimerKind, i32>>,
    save_timer: Cell<Option<i32>>,
    disposed: Cell<bool>,
    on_view: Box<dyn Fn(SyncView)>,
    on_changes: Box<dyn Fn(Changes)>,
}

#[derive(Clone)]
pub struct SyncHost(Rc<Shared>);

fn set_timeout(ms: i32, f: impl FnOnce() + 'static) -> Option<i32> {
    let window = web_sys::window()?;
    window.set_timeout_with_callback_and_timeout_and_arguments_0(Closure::once_into_js(f).unchecked_ref(), ms).ok()
}

fn clear_timeout(id: i32) {
    if let Some(window) = web_sys::window() {
        window.clear_timeout_with_handle(id);
    }
}

impl SyncHost {
    pub fn new(
        campaign: &str,
        base: &str,
        store: Rc<RefCell<Store>>,
        on_view: impl Fn(SyncView) + 'static,
        on_changes: impl Fn(Changes) + 'static,
    ) -> SyncHost {
        let machine = Machine::new(Config { batch_size: BATCH, has_extras: true, ..Config::default() });
        SyncHost(Rc::new(Shared {
            campaign: campaign.to_string(),
            base: base.to_string(),
            store,
            machine: RefCell::new(machine),
            notes: RefCell::default(),
            timers: RefCell::default(),
            save_timer: Cell::new(None),
            disposed: Cell::new(false),
            on_view: Box::new(on_view),
            on_changes: Box::new(on_changes),
        }))
    }

    pub fn store(&self) -> Rc<RefCell<Store>> {
        Rc::clone(&self.0.store)
    }

    pub fn notes(&self) -> usize {
        self.0.notes.borrow().len()
    }

    /// Ask for a round soon (a local edit, the window coming back, the person asking).
    pub fn kick(&self) {
        self.feed(Event::Kick);
    }

    /// The store was changed here: save what is due, paint the changes, and ask for a round.
    pub fn local_edit(&self) {
        let (actions, changes) = {
            let mut store = self.0.store.borrow_mut();
            let actions = self.0.machine.borrow_mut().after_local_edit(&mut store);
            (actions, store.take_changes())
        };
        if !changes.is_empty() {
            (self.0.on_changes)(changes);
        }
        self.run(actions);
    }

    pub fn feed(&self, event: Event) {
        if self.0.disposed.get() {
            return;
        }
        let (actions, changes) = {
            let mut store = self.0.store.borrow_mut();
            let actions = self.0.machine.borrow_mut().handle(&mut store, now_ms(), event);
            (actions, store.take_changes())
        };
        if !changes.is_empty() {
            (self.0.on_changes)(changes);
        }
        self.run(actions);
    }

    /// Save everything now (the page is being hidden or left).
    pub fn flush(&self) {
        if let Some(id) = self.0.save_timer.take() {
            clear_timeout(id);
        }
        let me = self.clone();
        spawn_local(async move { me.save(true).await });
    }

    async fn save(&self, with_overlay: bool) {
        // the snapshot is taken before the first await, so no borrow is held across it
        let snapshot = self.0.store.borrow().snapshot(with_overlay);
        persist::save(&self.0.campaign, &snapshot, with_overlay).await;
    }

    fn run(&self, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::Push(ops) => {
                    let me = self.clone();
                    spawn_local(async move {
                        let result = transport::push(&me.0.base, ops).await;
                        me.feed(Event::PushDone(result));
                    });
                }
                Action::Pull { since } => {
                    let me = self.clone();
                    spawn_local(async move {
                        let result = transport::pull(&me.0.base, since).await;
                        me.feed(Event::PullDone(result));
                    });
                }
                Action::RunExtras => {
                    let me = self.clone();
                    spawn_local(async move {
                        let result = me.pull_notes().await;
                        me.feed(Event::ExtrasDone(result));
                    });
                }
                Action::SetTimer { kind, after_ms } => {
                    self.cancel(kind);
                    let me = self.clone();
                    if let Some(id) = set_timeout(after_ms.min(i32::MAX as u64) as i32, move || {
                        me.0.timers.borrow_mut().remove(&kind);
                        me.feed(Event::Timer(kind));
                    }) {
                        self.0.timers.borrow_mut().insert(kind, id);
                    }
                }
                Action::CancelTimer(kind) => self.cancel(kind),
                Action::Save(Save::Outbox) => {
                    let me = self.clone();
                    spawn_local(async move { me.save(false).await });
                }
                Action::Save(Save::All) => self.save_later(),
                Action::Notify { state, pending, info } => {
                    flyermap_diag::breadcrumb(&format!("sync.{}", state.as_str()), Some(pending as i64));
                    (self.0.on_view)(SyncView { state, pending, last_ok_at: info.last_ok_at, last_error: info.last_error, notes: self.notes() });
                }
            }
        }
    }

    fn cancel(&self, kind: TimerKind) {
        if let Some(id) = self.0.timers.borrow_mut().remove(&kind) {
            clear_timeout(id);
        }
    }

    fn save_later(&self) {
        if self.0.save_timer.get().is_some() {
            return;
        }
        let me = self.clone();
        let id = set_timeout(SAVE_ALL_AFTER_MS, move || {
            me.0.save_timer.set(None);
            spawn_local(async move { me.save(true).await });
        });
        self.0.save_timer.set(id);
    }

    async fn pull_notes(&self) -> Result<(), NetError> {
        loop {
            let since = self.0.notes.borrow().cursor;
            let page = transport::pull_notes(&self.0.base, since).await?;
            let more = page.more && page.cursor > since;
            self.0.notes.borrow_mut().receive(page.notes, page.cursor);
            if !more {
                return Ok(());
            }
        }
    }

    pub fn dispose(&self) {
        self.feed(Event::Dispose);
        self.0.disposed.set(true);
        for (_, id) in self.0.timers.borrow_mut().drain() {
            clear_timeout(id);
        }
    }
}
