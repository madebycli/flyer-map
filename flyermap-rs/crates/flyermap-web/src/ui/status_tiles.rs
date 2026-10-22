//! The four statuses as tiles: the brush of the marking panel and the choice in the sheet of a house or a street are the same control, so a person
//! who has learned one has learned the other.
use super::{
    icon::Icon,
    palette::color::ink_on,
    status::{self, Kind, ORDER},
};
use crate::platform::Theme;
use flyermap_core::Status;
use leptos::prelude::*;

#[component]
pub fn StatusTiles(
    /// The status that is on (`None`: none is, e.g. a street whose pieces differ).
    #[prop(into)]
    selected: Signal<Option<Status>>,
    #[prop(into)] kind: Signal<Kind>,
    #[prop(into)] theme: Signal<Theme>,
    #[prop(into)] on_pick: Callback<Status>,
) -> impl IntoView {
    let tiles = ORDER
        .into_iter()
        .map(|s| {
            view! {
                <button
                    type="button"
                    class="fm-tile status"
                    data-status=s.as_str()
                    style:--c=move || status::color(theme.get(), s)
                    style:--ink=move || ink_on(status::color(theme.get(), s))
                    aria-label=move || status::label(kind.get(), s)
                    aria-pressed=move || (selected.get() == Some(s)).to_string()
                    on:click=move |_| on_pick.run(s)
                >
                    <Icon name=status::icon(s) size=22 />
                    <span>{move || status::label(kind.get(), s)}</span>
                </button>
            }
        })
        .collect_view();
    view! { <div class="fm-tiles4" role="group" aria-label="Status">{tiles}</div> }
}
