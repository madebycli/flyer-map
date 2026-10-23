//! The app's reactive state, provided once as context: the shell (one signal around the pure [`Shell`]), the device settings, the session
//! (backend and what it said) and the few values the zones share.
use crate::{
    drawing::{Draw, Ready},
    engine::Route,
    features::settings::Prefs,
    map::pointer::PointerDriver,
    marking::{MarkState, SAVED_KEY},
    platform::{events::on_window, storage::KeyValue, LocalStore},
    session::{Applied, Session},
    shell::{layout_for, Action, Layout, Panel, Shell, Tool},
};
use leptos::prelude::*;
use std::rc::Rc;

#[derive(Clone, Copy)]
pub struct AppState {
    pub shell: RwSignal<Shell>,
    pub prefs: Prefs,
    pub session: Session,
    pub layout: RwSignal<Layout>,
    /// The Lauf the map follows (a tap on a person in the live strip).
    pub following: RwSignal<Option<String>>,
    /// The marking tool: mode, brush, options, the points of a route.
    pub mark: RwSignal<MarkState>,
    /// The route the engine found for the points (`None`: none asked for yet).
    pub route: RwSignal<Option<Route>>,
    /// What the last markings replaced, newest last (the undo).
    pub undo: RwSignal<Vec<Applied>>,
    /// The drawing tool: the kind, the target Gebiet, the points tapped.
    pub draw: RwSignal<Draw>,
    /// A finished drawing that waits for its name (the save sheet is open).
    pub saving: RwSignal<Option<Ready>>,
    /// What the server said when it refused to store a drawing.
    pub save_error: RwSignal<Option<String>>,
    /// The finger driver of the map, once the map exists.
    pub driver: StoredValue<Option<Rc<PointerDriver>>, LocalStorage>,
}

fn window_width() -> f64 {
    web_sys::window().and_then(|w| w.inner_width().ok()).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

impl AppState {
    pub fn new(prefs: Prefs, session: Session) -> AppState {
        let layout = RwSignal::new(layout_for(window_width()));
        // the listener lives as long as the page
        if let Some(listener) = on_window("resize", move || layout.set(layout_for(window_width()))) {
            std::mem::forget(listener);
        }
        let mark = MarkState::load(LocalStore.read(SAVED_KEY).as_deref());
        AppState {
            shell: RwSignal::new(Shell::default()),
            prefs,
            session,
            layout,
            following: RwSignal::new(None),
            mark: RwSignal::new(mark),
            route: RwSignal::new(None),
            undo: RwSignal::new(Vec::new()),
            draw: RwSignal::new(Draw::default()),
            saving: RwSignal::new(None),
            save_error: RwSignal::new(None),
            driver: StoredValue::new_local(None),
        }
    }

    pub fn dispatch(&self, action: Action) {
        self.shell.update(|s| s.reduce(action));
    }

    pub fn notify(&self, text: impl Into<String>) {
        self.dispatch(Action::Notify(text.into()));
    }

    /// A callback that dispatches a fixed action (for buttons).
    pub fn on(&self, action: Action) -> Callback<()> {
        let state = *self;
        Callback::new(move |_| state.dispatch(action.clone()))
    }

    /// The open sheet; changes only when another sheet opens, not with every note.
    pub fn panel(&self) -> Memo<Option<Panel>> {
        let shell = self.shell;
        Memo::new(move |_| shell.with(|s| s.panel.clone()))
    }

    pub fn tool(&self) -> Memo<Tool> {
        let shell = self.shell;
        Memo::new(move |_| shell.with(|s| s.tool))
    }

    pub fn open(&self, panel: Panel) {
        self.dispatch(Action::Open(panel));
    }
}
