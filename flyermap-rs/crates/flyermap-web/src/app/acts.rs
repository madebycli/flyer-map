//! What an action of a sheet does. One place, so a button in the Studio and the same button in a sheet at the map do the same thing.
use super::{draw, state::AppState};
use crate::{
    drawing::Kind,
    engine::LngLat,
    model::{ring_bounds, ring_center, Act, Subject},
    platform::geo,
    shell::{Action, Panel},
};
use leptos::prelude::*;

/// Space around a Gebiet that is shown whole (px), and how close a house or a street piece is brought (zoom).
const FIT_PADDING: f64 = 70.0;
const CLOSE_ZOOM: f64 = 17.5;
/// How long after a sheet opens the map is moved out from under it.
pub const REVEAL_AFTER: std::time::Duration = std::time::Duration::from_millis(90);

/// The Gebiet a subject belongs to, for the actions that need a place (follow a Lauf: go to its Gebiet).
fn gebiet_of(state: AppState, subject: &Subject) -> Option<String> {
    state.session.world.with_untracked(|w| match subject {
        Subject::Gebiet(id) => Some(id.clone()),
        Subject::Lauf(id) => w.lauf(id).map(|l| l.gebiet.clone()),
        _ => None,
    })
}

/// Where a subject lies on the map: the middle of a Gebiet, a house, the middle of a street piece.
pub fn position_of(state: AppState, subject: &Subject) -> Option<LngLat> {
    let s = state.session;
    let in_world = s.world.with_untracked(|w| match subject {
        Subject::Gebiet(id) => w.gebiet(id).and_then(|g| ring_center(&g.ring)),
        Subject::Lauf(id) => w.lauf(id).and_then(|l| w.gebiet(&l.gebiet)).and_then(|g| ring_center(&g.ring)),
        _ => None,
    });
    in_world.or_else(|| {
        let loaded = s.loaded.get_untracked()?;
        match subject {
            Subject::Haus(id) => loaded.field.index.houses.get(id).map(|h| h.center),
            Subject::Strasse(id) => loaded.field.index.segments.get(id).map(|g| g.mid),
            _ => None,
        }
    })
}

/// Bring the map to a subject: a Gebiet is shown whole, a house or a street piece close.
pub fn fly_to(state: AppState, subject: &Subject) {
    let s = state.session;
    let Some(map) = s.map.get_untracked() else { return };
    let whole = s.world.with_untracked(|w| match subject {
        Subject::Gebiet(id) => w.gebiet(id).and_then(|g| ring_bounds(&g.ring)),
        Subject::Lauf(id) => w.lauf(id).and_then(|l| w.gebiet(&l.gebiet)).and_then(|g| ring_bounds(&g.ring)),
        _ => None,
    });
    match (whole, position_of(state, subject)) {
        (Some(bounds), _) => map.fit(bounds, FIT_PADDING),
        // the sheet of the thing is built a moment later; the map goes to the part of the stage it does not cover
        (None, Some(at)) => set_timeout(move || map.reveal(at, Some(CLOSE_ZOOM)), REVEAL_AFTER),
        (None, None) => {}
    }
}

/// The position of the person on the map and, if it is known, the camera goes there.
pub fn locate(state: AppState) {
    let s = state.session;
    geo::locate(move |found| match found {
        Ok(fix) => {
            if let Some(map) = s.map.get_untracked() {
                map.set_position(Some(fix.at));
                map.focus(fix.at, 17.0);
            }
        }
        Err(e) => state.notify(e.message()),
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
            fly_to(state, &subject);
        }
        Act::DrawConnect | Act::DrawExtend | Act::Split => {
            let kind = match act {
                Act::DrawConnect => Kind::Connect,
                Act::DrawExtend => Kind::Extend,
                _ => Kind::Split,
            };
            let target = match &subject {
                Subject::Gebiet(id) => Some(id.clone()),
                _ => None,
            };
            draw::start(state, kind, target, None);
        }
        Act::NewGebiet => {
            let gruppe = match &subject {
                Subject::Gruppe(id) => Some(id.clone()),
                _ => None,
            };
            draw::start(state, Kind::Free, None, gruppe);
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
