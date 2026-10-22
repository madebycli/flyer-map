//! What an action of a sheet does. One place, so a button in the Studio and the same button in a sheet at the map do the same thing.
use super::state::AppState;
use crate::{
    model::{Act, Subject},
    shell::{Action, Panel},
};
use leptos::prelude::*;

/// The Gebiet a subject belongs to, for the actions that need a place (follow a Lauf: go to its Gebiet).
fn gebiet_of(state: AppState, subject: &Subject) -> Option<String> {
    state.session.world.with_untracked(|w| match subject {
        Subject::Gebiet(id) => Some(id.clone()),
        Subject::Lauf(id) => w.lauf(id).map(|l| l.gebiet.clone()),
        _ => None,
    })
}

pub fn run(state: AppState, subject: Subject, act: Act) {
    match act {
        Act::Follow => {
            let id = match &subject {
                Subject::Lauf(id) => Some(id.clone()),
                _ => None,
            };
            let was = state.following.get_untracked();
            state.following.set(if was == id { None } else { id });
            state.dispatch(Action::Close);
        }
        Act::Show => {
            if gebiet_of(state, &subject).is_some() {
                state.dispatch(Action::Close);
            }
        }
        other => {
            state.notify(format!("„{}“ kommt in einem der nächsten Schritte.", crate::features::subject::act_label(other, flyermap_identity::Art::Austeilen).0))
        }
    }
}

/// A tap on a thing opens its sheet.
pub fn open_subject(state: AppState, subject: Subject) {
    state.dispatch(Action::Open(Panel::Subject(subject)));
}
