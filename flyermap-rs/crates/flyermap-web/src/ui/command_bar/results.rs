//! The results card that floats under the bar (`.v5-spot`): neither the bar nor the map move when it opens.
use super::hit::{Hit, HitKind};
use crate::ui::icon::{Icon, IconName};
use leptos::{ev, prelude::*};

#[component]
pub fn Results(#[prop(into)] hits: Signal<Vec<Hit>>, #[prop(into)] on_pick: Callback<Hit>) -> impl IntoView {
    let row = move |hit: Hit| {
        let icon = if hit.kind == HitKind::Street { IconName::Road } else { IconName::House };
        let (label, kind, detail) = (hit.label.clone(), hit.kind.label(), hit.detail.clone());
        view! {
            <button
                type="button"
                class="v5-result"
                role="option"
                aria-selected="false"
                // keeps the focus in the field, so the card does not close before the click lands
                on:mousedown=|e: ev::MouseEvent| e.prevent_default()
                on:click=move |_| on_pick.run(hit.clone())
            >
                <span class="v5-result-ico"><Icon name=icon size=22 /></span>
                <span class="v5-result-text"><b>{label}</b><small>{kind}</small></span>
                <small class="v5-result-detail">{detail}</small>
            </button>
        }
    };
    view! {
        <div class="v5-spot" role="listbox" aria-label="Suchergebnisse">
            {move || {
                let list = hits.get();
                if list.is_empty() {
                    view! {
                        <p class="v5-spot-empty">
                            <Icon name=IconName::Search size=22 />
                            "Nichts gefunden. Prüfe die Schreibweise oder suche nur nach dem Straßennamen."
                        </p>
                    }
                    .into_any()
                } else {
                    list.into_iter().map(row).collect_view().into_any()
                }
            }}
        </div>
    }
}
