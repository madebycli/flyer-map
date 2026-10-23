//! The results card (`.v5-spot`): neither the bar nor the map move when it opens. Results stand under their heading, the typed letters are set in bold,
//! the row the keyboard is on is marked (and scrolled into view), and a row is a 58 px target.
use super::{
    highlight::pieces,
    hit::{Hit, ResultGroup},
};
use crate::ui::icon::{Icon, IconName};
use leptos::{ev, prelude::*};
use wasm_bindgen::JsCast;

/// The `id` of the list (the field's `aria-controls`).
pub const LIST_ID: &str = "fm-spot";

/// The `id` of the row with this index in the flat list (the field's `aria-activedescendant`).
pub fn option_id(index: usize) -> String {
    format!("fm-opt-{index}")
}

fn scroll_to(index: usize) {
    let Some(el) = web_sys::window().and_then(|w| w.document()).and_then(|d| d.get_element_by_id(&option_id(index))) else { return };
    let options = web_sys::ScrollIntoViewOptions::new();
    options.set_block(web_sys::ScrollLogicalPosition::Nearest);
    if let Ok(el) = el.dyn_into::<web_sys::HtmlElement>() {
        el.scroll_into_view_with_scroll_into_view_options(&options);
    }
}

#[component]
pub fn Results(
    #[prop(into)] groups: Signal<Vec<ResultGroup>>,
    #[prop(into)] active: Signal<Option<usize>>,
    #[prop(into)] on_pick: Callback<Hit>,
) -> impl IntoView {
    Effect::new(move |_| {
        if let Some(i) = active.get() {
            scroll_to(i);
        }
    });
    let row = move |index: usize, hit: Hit| {
        let icon = hit.icon.unwrap_or_else(|| hit.kind.icon());
        let (kind, detail) = (hit.kind.label(), hit.detail.clone());
        let label = pieces(&hit.label, &hit.marks)
            .into_iter()
            .map(|p| if p.hit { view! { <mark>{p.text}</mark> }.into_any() } else { view! { {p.text} }.into_any() })
            .collect_view();
        view! {
            <button
                type="button"
                class="v5-result"
                id=option_id(index)
                role="option"
                tabindex="-1"
                data-kind=kind
                aria-selected=move || (active.get() == Some(index)).to_string()
                data-active=move || (active.get() == Some(index)).to_string()
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
        <div class="v5-spot" id=LIST_ID role="listbox" aria-label="Suchergebnisse">
            {move || {
                let list = groups.get();
                if list.iter().all(|g| g.hits.is_empty()) {
                    return view! {
                        <p class="v5-spot-empty" role="status">
                            <Icon name=IconName::Search size=22 />
                            "Nichts gefunden. Prüfe die Schreibweise oder suche nur nach dem Straßennamen."
                        </p>
                    }
                    .into_any();
                }
                let mut index = 0;
                list.into_iter()
                    .map(|group| {
                        let rows = group
                            .hits
                            .into_iter()
                            .map(|hit| {
                                let at = index;
                                index += 1;
                                row(at, hit)
                            })
                            .collect_view();
                        view! {
                            <div class="fm-spot-group" role="group" aria-label=group.title>
                                <h3 class="fm-spot-h" aria-hidden="true">{group.title}</h3>
                                {rows}
                            </div>
                        }
                    })
                    .collect_view()
                    .into_any()
            }}
        </div>
    }
}
