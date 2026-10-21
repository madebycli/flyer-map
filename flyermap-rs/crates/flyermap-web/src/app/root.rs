//! The app's frame: the zones of the field shell. The map fills the screen; the bar floats at the top; one sheet zone at the bottom; notes
//! under the bar; a card over everything when something needs an answer. (The right rail, the context chip and the marking button follow in M5.)
use super::{
    dialog::dialog_view,
    fake::CAMPAIGN,
    panels::panel_view,
    shell::{ui_state, Action, Panel},
    state::AppState,
};
use crate::{
    features::{map_stub::MapStub, search::find},
    ui::{CommandBar, Hit, StatusPill, Toast},
};
use leptos::prelude::*;
use std::time::Duration;

/// A note stays this long unless dismissed (as in `App.tsx`).
const NOTICE_FOR: Duration = Duration::from_secs(9);

#[component]
pub fn App(state: AppState) -> impl IntoView {
    provide_context(state);
    let panel = state.panel();
    let notice = Memo::new(move |_| state.shell.with(|s| s.notice.clone()));
    let dialog = Memo::new(move |_| state.shell.with(|s| s.dialog));

    // every new note gets its own timer; an older timer cannot remove a newer note (see `Shell::reduce`)
    Effect::new(move |_| {
        if let Some(id) = notice.with(|n| n.as_ref().map(|n| n.id)) {
            set_timeout(move || state.dispatch(Action::Dismiss(id)), NOTICE_FOR);
        }
    });

    let (streets, houses) = state
        .world
        .with_value(|w| (w.streets.clone(), w.houses.clone()));
    let pill = Signal::derive(move || state.world.with_value(|w| w.pill.clone()));
    let search =
        Callback::new(move |query: String| state.world.with_value(|w| find(&w.places, &query)));
    let on_pick = move |hit: Hit| {
        state.dispatch(Action::Notify(format!(
            "{} ({}): die Karte fliegt dorthin, sobald sie in der neuen Oberfläche ist.",
            hit.label, hit.detail
        )));
    };
    let on_focus = move |_| {
        if panel.get_untracked().is_some() {
            state.dispatch(Action::Close);
        }
    };

    view! {
        <div class="v5-root" data-ui=move || ui_state(true, panel.get()) data-hand=move || state.prefs.hand.get().as_str()>
            <MapStub streets=streets houses=houses theme=state.prefs.theme />
            <CommandBar on_menu=state.on(Action::Open(Panel::Menu)) search=search on_pick=on_pick on_focus=on_focus>
                <StatusPill campaign=CAMPAIGN state=pill on_click=state.on(Action::Open(Panel::Overview)) />
            </CommandBar>
            {move || notice.get().map(|n| view! { <Toast text=n.text on_dismiss=state.on(Action::Dismiss(n.id)) /> })}
            {move || panel.get().map(|p| panel_view(state, p))}
            {move || dialog.get().map(|d| dialog_view(state, d))}
        </div>
    }
}
