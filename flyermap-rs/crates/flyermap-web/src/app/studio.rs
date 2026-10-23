//! The Studio wired to the app: the tabs the rights allow, the rows of the chosen tab from the world and the progress, a row opens the sheet of the thing and shows
//! it on the map, the lists are asked for again when the Studio opens and when a tab is chosen, and the Läufe are polled while the page is visible (the live
//! strip lives on them).
use super::{
    acts::{fly_to, open_subject},
    state::AppState,
};
use crate::{
    features::studio::{empty_text, rows, tabs, StudioPanel},
    model::Subject,
    platform::{events::page_visible, time::now_ms},
    shell::{Action, StudioTab, Tool},
};
use flyermap_identity::Action as Right;
use leptos::prelude::*;
use std::time::Duration;

/// How often who is out is asked for.
const POLL: Duration = Duration::from_secs(15);

/// Keep the live lists fresh for as long as the caller (the frame) lives.
pub fn watch(state: AppState) {
    let s = state.session;
    if let Ok(handle) = set_interval_with_handle(
        move || {
            if page_visible() {
                s.refresh_laeufe();
            }
        },
        POLL,
    ) {
        on_cleanup(move || handle.clear());
    }
    // people and access are only asked for by those who manage them
    Effect::new(move |_| {
        if s.rights.with(|r| r.can_aktion(Right::ManagePeople)) {
            s.refresh_people();
        }
    });
}

/// The content of the Studio: the column on a wide screen, the body of a sheet on a phone.
pub fn panel(state: AppState) -> AnyView {
    let s = state.session;
    let tab_list = Signal::derive(move || s.rights.with(tabs));
    // a tab the rights do not offer (the person lost the right) falls back to the first
    let tab = Signal::derive(move || {
        let chosen = state.shell.with(|sh| sh.studio_tab);
        tab_list.with(|list| if list.contains(&chosen) { chosen } else { StudioTab::Gebiete })
    });
    let rows_of = move |t: StudioTab| s.world.with(|w| s.progress.with(|p| rows(t, w, p, now_ms())));
    let list = Signal::derive(move || rows_of(tab.get()));
    let counts = Signal::derive(move || StudioTab::ALL.iter().map(|t| (*t, rows_of(*t).len())).collect::<Vec<_>>());
    let empty = Signal::derive(move || {
        let name = match tab.get() {
            StudioTab::Personen => "Personen",
            StudioTab::Zugaenge => "Zugänge",
            _ => "",
        };
        empty_text(tab.get(), s.missing.with(|m| m.iter().any(|x| x == name)))
    });
    let can_draw = Signal::derive(move || s.world.with(|w| s.rights.with(|r| r.may_draw_somewhere(&w.gebiete))));
    // the chosen list is fresh when it is looked at
    Effect::new(move |_| match tab.get() {
        StudioTab::Laeufe => s.refresh_laeufe(),
        StudioTab::Personen | StudioTab::Zugaenge => s.refresh_people(),
        _ => {}
    });
    let on_open = move |subject: Subject| {
        fly_to(state, &subject);
        open_subject(state, subject);
    };
    view! {
        <StudioPanel
            tab=tab
            tabs=tab_list
            counts=counts
            rows=list
            empty=empty
            on_tab=move |t| state.dispatch(Action::StudioTab(t))
            on_open=on_open
            can_draw=can_draw
            on_draw=move |()| state.dispatch(Action::SetTool(Tool::Draw))
        />
    }
    .into_any()
}
