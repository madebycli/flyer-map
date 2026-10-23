//! The sheet of a house or a street piece, wired to the app: what the map data and the store say about it, the status choice (the same marking as the panel's,
//! with the same undo), and the glow on the map while the sheet is open.
use super::{acts, marking, state::AppState};
use crate::{
    features::subject::{describe_object, status_line, summarize, GoneSheet, ObjectSheet},
    marking::MarkAction,
    model::{Act, Subject},
    shell::{Action, Panel},
    ui::status::Kind,
};
use flyermap_core::Key;
use flyermap_identity::Art;
use leptos::prelude::*;

pub fn sheet(state: AppState, subject: Subject) -> AnyView {
    let s = state.session;
    let close = state.on(Action::Close);
    let Some(loaded) = s.loaded.get_untracked() else {
        return view! { <GoneSheet on_close=close /> }.into_any();
    };
    let found = s.world.with_untracked(|w| s.rights.with_untracked(|r| describe_object(&subject, &loaded.field.index, &loaded.field.area_of, w, r)));
    let Some(object) = found else {
        return view! { <GoneSheet on_close=close /> }.into_any();
    };
    let is_street = object.is_street;
    let (plain, along) = (object.keys.clone(), object.keys_with_houses.clone());
    let with_houses = Signal::derive(move || state.mark.with(|m| m.with_houses));
    // what a choice sets: the thing, and the houses along a street when that is on
    let targets = Signal::derive(move || if is_street && with_houses.get() { along.clone() } else { plain.clone() });
    let kind = Signal::derive(move || if s.world.with(|w| w.aktion.art == Art::Abholen) { Kind::Collection } else { Kind::Distribution });
    let store = StoredValue::new_local(loaded.host.store());
    let summary = Memo::new(move |_| {
        s.changed.track();
        targets.with(|keys| summarize(keys, |k: &Key| store.with_value(|st| st.borrow().status_of(k))))
    });
    let line = Signal::derive(move || status_line(&summary.get(), kind.get(), is_street));
    let selected = Signal::derive(move || summary.get().uniform);
    let on_status = move |status| {
        // the tile that is on already: nothing to set, and nothing to say
        if selected.get_untracked() != Some(status) {
            marking::apply(state, targets.get_untracked(), status);
        }
    };
    let on_houses = move |()| state.mark.update(|m| m.reduce(MarkAction::ToggleHouses));
    let art = s.world.with_untracked(|w| w.aktion.art);
    let on_act = Callback::new(move |act: Act| acts::run(state, subject.clone(), act));
    view! {
        <ObjectSheet
            view=object.view
            art=art
            is_street=is_street
            line=line
            selected=selected
            kind=kind
            theme=state.prefs.theme
            with_houses=with_houses
            on_houses=on_houses
            on_status=on_status
            on_act=on_act
            on_close=close
        />
    }
    .into_any()
}

/// The keys that glow on the map while the sheet of a house or a street piece is open (the piece with its houses). Tracks the sheet and the map data.
pub fn highlighted(state: AppState) -> Vec<Key> {
    let s = state.session;
    let subject = state.shell.with(|sh| match &sh.panel {
        Some(Panel::Subject(subject @ (Subject::Haus(_) | Subject::Strasse(_)))) => Some(subject.clone()),
        _ => None,
    });
    let (Some(subject), Some(loaded)) = (subject, s.loaded.get()) else { return Vec::new() };
    match subject {
        Subject::Haus(id) => vec![Key::house(&id)],
        Subject::Strasse(id) => loaded.field.index.keys_for_groups([id.as_str()], true, false),
        _ => Vec::new(),
    }
}
