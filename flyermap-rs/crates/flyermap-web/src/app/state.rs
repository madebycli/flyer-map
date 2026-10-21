//! The app's reactive state, provided once as context: the shell (one signal around the pure [`Shell`]), the device settings and the data.
use super::{
    fake::World,
    shell::{Action, Panel, Shell},
};
use crate::{features::settings::Prefs, ui::status::Kind};
use leptos::prelude::*;

#[derive(Clone, Copy)]
pub struct AppState {
    pub shell: RwSignal<Shell>,
    pub prefs: Prefs,
    pub world: StoredValue<World>,
}

impl AppState {
    pub fn new(prefs: Prefs, world: World) -> AppState {
        AppState {
            shell: RwSignal::new(Shell::default()),
            prefs,
            world: StoredValue::new(world),
        }
    }

    pub fn dispatch(&self, action: Action) {
        self.shell.update(|s| s.reduce(action));
    }

    /// A callback that dispatches a fixed action (for buttons).
    pub fn on(&self, action: Action) -> Callback<()> {
        let state = *self;
        Callback::new(move |_| state.dispatch(action.clone()))
    }

    /// The open sheet; changes only when another sheet opens, not with every note.
    pub fn panel(&self) -> Memo<Option<Panel>> {
        let shell = self.shell;
        Memo::new(move |_| shell.with(|s| s.panel))
    }

    pub fn kind(&self) -> Memo<Kind> {
        let shell = self.shell;
        Memo::new(move |_| shell.with(|s| s.kind))
    }
}
