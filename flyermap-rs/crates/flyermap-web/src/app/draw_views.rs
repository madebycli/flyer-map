//! The screens of the drawing tool, filled from the app's state: the panel in the panel zone and the sheet that names a new Gebiet.
use super::{draw, state::AppState};
use crate::{
    drawing::{confirm_label, kinds_for, ready_text, Verdict},
    features::draw::{Choice, DrawPanel, SaveSheet},
    model::Gruppe,
};
use flyermap_identity::{Action as Right, Art};
use leptos::prelude::*;

pub fn panel(state: AppState) -> AnyView {
    let s = state.session;
    let verdict = draw::verdict(state);
    let kinds = Signal::derive(move || {
        let areas = draw::areas(state);
        let collecting = s.world.with(|w| w.aktion.art == Art::Abholen);
        let may_new = s.world.with(|w| s.rights.with(|r| r.may_draw_somewhere(&w.gebiete)));
        kinds_for(&areas, may_new, collecting)
    });
    let kind = Signal::derive(move || state.draw.with(|d| d.kind));
    let hint = Signal::derive(move || match verdict.get() {
        Verdict::Next(text) | Verdict::Bad(text) => text,
        Verdict::Ready(_) => ready_text(kind.get()).to_string(),
    });
    let bad = Signal::derive(move || matches!(verdict.get(), Verdict::Bad(_)));
    let size = Signal::derive(move || match verdict.get() {
        Verdict::Ready(r) => Some(r.size),
        _ => None,
    });
    let confirm_enabled = Signal::derive(move || matches!(verdict.get(), Verdict::Ready(_)));
    let undo_enabled = Signal::derive(move || state.draw.with(|d| !d.is_empty()));
    view! {
        <DrawPanel
            kinds=kinds
            kind=kind
            hint=hint
            bad=bad
            size=size
            confirm_label=Signal::derive(move || confirm_label(kind.get()).to_string())
            confirm_enabled=confirm_enabled
            undo_enabled=undo_enabled
            on_kind=move |k| draw::set_kind(state, k)
            on_undo=move |()| draw::undo(state)
            on_confirm=move |()| draw::confirm(state)
        />
    }
    .into_any()
}

/// The Gruppen the person may draw for (the server decides again), the one the drawing was started for first.
fn choices(state: AppState) -> Vec<Choice> {
    let s = state.session;
    let wanted = state.draw.with_untracked(|d| d.gruppe.clone());
    let mut list: Vec<Choice> = s.world.with_untracked(|w| {
        s.rights.with_untracked(|r| {
            let allowed = |g: &&Gruppe| r.can_aktion(Right::DrawArea) || r.can_gruppe(Right::DrawArea, &g.id);
            w.gruppen.iter().filter(allowed).map(|g| Choice { id: g.id.clone(), name: g.name.clone(), color: g.color.clone() }).collect()
        })
    });
    if let Some(at) = wanted.and_then(|id| list.iter().position(|c| c.id == id)) {
        let first = list.remove(at);
        list.insert(0, first);
    }
    list
}

pub fn save_sheet(state: AppState) -> AnyView {
    let Some(ready) = state.saving.get_untracked() else {
        // the drawing is gone (Escape): nothing to name
        return ().into_any();
    };
    let list = choices(state);
    let name = RwSignal::new(s_name(state, &ready));
    let gruppe = RwSignal::new(list.first().map(|c| c.id.clone()));
    let saving = RwSignal::new(false);
    let on_save = move |()| {
        saving.set(true);
        draw::save(state, name.get_untracked(), gruppe.get_untracked());
    };
    // a refusal ends "saving": the button works again
    Effect::new(move |_| {
        if state.save_error.with(Option::is_some) {
            saving.set(false);
        }
    });
    view! {
        <SaveSheet
            kind=ready.kind
            size=ready.size.clone()
            name=name
            choices=list
            gruppe=gruppe
            error=state.save_error
            saving=saving
            on_save=on_save
            on_back=move |()| draw::back_to_drawing(state)
        />
    }
    .into_any()
}

fn s_name(state: AppState, ready: &crate::drawing::Ready) -> String {
    state.session.world.with_untracked(|w| crate::drawing::suggest_name(&w.gebiete, ready.kind))
}
