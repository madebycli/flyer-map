//! The keyboard on the page wired to the app: `/` or Ctrl+K for the search, Escape for back, `m` for marking, `1`..`4` for its modes, `u` or Ctrl+Z for the
//! undo, `?` for the help. The rules are `shell::keys` (pure); this carries them out. A pointer does everything a key does, so this is a second way, not the only one.
use super::{marking, search::SearchHost, state::AppState};
use crate::{
    marking::{MarkAction, Mode},
    platform::keyboard::on_keydown,
    shell::{shortcut, Action, Panel, Screen, Shortcut, Tool},
};
use leptos::prelude::*;

fn run(state: AppState, find: SearchHost, what: Shortcut) {
    match what {
        Shortcut::FocusSearch => find.focus(),
        Shortcut::Back => {
            if state.shell.with_untracked(|s| s.panel.is_some()) {
                state.dispatch(Action::Close);
            } else {
                state.dispatch(Action::SetTool(Tool::Idle));
            }
        }
        Shortcut::ToggleMark => {
            let may = state.session.world.with_untracked(|w| state.session.rights.with_untracked(|r| r.may_mark_somewhere(&w.gebiete)));
            let on = state.shell.with_untracked(|s| s.tool == Tool::Mark);
            if on || may {
                state.dispatch(Action::SetTool(if on { Tool::Idle } else { Tool::Mark }));
            }
        }
        Shortcut::Mode(i) => {
            if let Some(mode) = Mode::ALL.get(i) {
                state.mark.update(|m| m.reduce(MarkAction::SetMode(*mode)));
            }
        }
        Shortcut::Undo => marking::undo(state),
        Shortcut::Help => state.open(Panel::Help),
    }
}

pub fn install(state: AppState, find: SearchHost) {
    let watch = on_keydown(move |pressed| {
        let screen = state.shell.with_untracked(|s| Screen { tool: s.tool, sheet_open: s.panel.is_some() });
        match shortcut(&pressed.key, pressed.command, pressed.alt, pressed.typing, screen) {
            Some(what) => {
                run(state, find, what);
                true
            }
            None => false,
        }
    });
    // owned by the frame: the listener goes when the frame does
    let _ = StoredValue::new_local(watch);
}
