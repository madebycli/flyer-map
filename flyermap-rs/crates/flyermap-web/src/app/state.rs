//! The app's reactive state, provided once as context: the shell (one signal around the pure [`Shell`]), the device settings, the session
//! (backend and what it said) and the few values the zones share.
use crate::{
    features::settings::Prefs,
    platform::events::on_window,
    session::Session,
    shell::{layout_for, Action, Layout, Panel, Shell, Tool},
};
use leptos::prelude::*;

#[derive(Clone, Copy)]
pub struct AppState {
    pub shell: RwSignal<Shell>,
    pub prefs: Prefs,
    pub session: Session,
    pub layout: RwSignal<Layout>,
    /// The Lauf the map follows (a tap on a person in the live strip).
    pub following: RwSignal<Option<String>>,
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
        AppState { shell: RwSignal::new(Shell::default()), prefs, session, layout, following: RwSignal::new(None) }
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
