//! The sheet of a house or a street piece: what its status is in words, the four statuses to choose from (when the person may set one), and for a street
//! whether the houses along it go with it. The choice is the same tiles as the marking panel's brush; the actions below are the thing's own (show it).
use super::{sheet::SubjectSheet, view::SubjectView};
use crate::{
    model::Act,
    platform::Theme,
    ui::{status::Kind, Icon, IconName, StatusTiles},
};
use flyermap_core::Status;
use flyermap_identity::Art;
use leptos::prelude::*;

#[component]
pub fn ObjectSheet(
    view: SubjectView,
    art: Art,
    /// A street piece: the choice offers to take the houses along.
    is_street: bool,
    /// The status of the thing now, in words ("Ausgeteilt", "3 von 5 Häusern ausgeteilt").
    #[prop(into)]
    line: Signal<String>,
    /// The status all of it has (`None`: it differs).
    #[prop(into)]
    selected: Signal<Option<Status>>,
    #[prop(into)] kind: Signal<Kind>,
    #[prop(into)] theme: Signal<Theme>,
    /// Whether the houses go along with a street piece.
    #[prop(into)]
    with_houses: Signal<bool>,
    #[prop(into)] on_houses: Callback<()>,
    #[prop(into)] on_status: Callback<Status>,
    #[prop(into)] on_act: Callback<Act>,
    #[prop(into)] on_close: Callback<()>,
) -> impl IntoView {
    let can_set = view.acts.contains(&Act::SetStatus);
    let houses = move || {
        (is_street && can_set).then(|| {
            view! {
                <button type="button" class="fm-toggle" data-option="houses" aria-pressed=move || with_houses.get().to_string() on:click=move |_| on_houses.run(())>
                    <Icon name=IconName::House size=20 />
                    <span>"Häuser an der Straße mitmarkieren"</span>
                </button>
            }
        })
    };
    view! {
        <SubjectSheet view=view art=art on_act=on_act on_close=on_close>
            <p class="fm-status-line" data-role="status-line" role="status">{move || line.get()}</p>
            {can_set
                .then(|| view! { <StatusTiles selected=selected kind=kind theme=theme on_pick=on_status /> })}
            {houses}
            {(!can_set).then(|| view! { <p class="v5-hint"><Icon name=IconName::Info size=20 />"Du kannst das hier ansehen, aber nicht ändern."</p> })}
        </SubjectSheet>
    }
}
