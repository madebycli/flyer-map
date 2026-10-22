//! The bar at the top of the map, the one place for "where am I and where to": search and status. It never changes size. Typing opens the results as a
//! card (under the bar; above the keyboard on a phone, where the thumb is); a tap or Enter on a result picks it and closes the card. The arrow keys walk the
//! results, so a keyboard is as good as a finger. What is searched, and in which order, is the host's business: the bar gets the typed text out and the groups in.
use super::{
    cursor::{self, step_for},
    hit::{card_open, flat, Hit, ResultGroup},
    results::{option_id, Results, LIST_ID},
};
use crate::ui::icon::{Icon, IconName};
use leptos::{ev, html, prelude::*};
use std::time::Duration;

/// How long the card stays after the field loses focus, so a tap on a result still lands.
const BLUR_GRACE: Duration = Duration::from_millis(120);

#[component]
pub fn CommandBar(
    /// The typed text; the host watches it and answers with `groups`.
    query: RwSignal<String>,
    #[prop(into)] groups: Signal<Vec<ResultGroup>>,
    /// The host is still looking (an answer may come).
    #[prop(into)]
    busy: Signal<bool>,
    #[prop(into)] on_pick: Callback<Hit>,
    /// Called when the field gets the focus (the app closes an open sheet then).
    #[prop(optional, into)]
    on_focus: Option<Callback<()>>,
    /// The field, for the shortcut that focuses it.
    #[prop(optional)]
    input: NodeRef<html::Input>,
    /// The status at the right end (the pill).
    children: Children,
) -> impl IntoView {
    let focused = RwSignal::new(false);
    let active = RwSignal::new(None::<usize>);
    // `autocorrect` (Safari) is not among the attributes `view!` knows, and a name without a dash cannot be written as a custom one.
    Effect::new(move |_| {
        if let Some(el) = input.get() {
            let _ = el.set_attribute("autocorrect", "off");
        }
    });
    let open = Memo::new(move |_| card_open(focused.get()));
    let hits = Memo::new(move |_| groups.with(|g| flat(g)));
    // a new list starts at the top again
    Effect::new(move |_| {
        groups.track();
        active.set(None);
    });

    let finish = move || {
        query.set(String::new());
        if let Some(el) = input.get_untracked() {
            let _ = el.blur();
        }
    };
    let pick = move |hit: Hit| {
        on_pick.run(hit);
        finish();
    };
    let on_key = move |e: ev::KeyboardEvent| {
        let key = e.key();
        if let Some(step) = step_for(&key) {
            // Home and End belong to the text while there is text to move in
            if matches!(key.as_str(), "Home" | "End") && query.with_untracked(|q| !q.is_empty()) {
                return;
            }
            e.prevent_default();
            active.update(|a| *a = cursor::step(*a, hits.with_untracked(Vec::len), step));
            return;
        }
        match key.as_str() {
            "Enter" => {
                let chosen = hits.with_untracked(|h| cursor::enter(active.get_untracked(), h.len()).map(|i| h[i].clone()));
                if let Some(hit) = chosen {
                    e.prevent_default();
                    pick(hit);
                }
            }
            "Escape" => finish(),
            _ => {}
        }
    };
    let clear = move |_| {
        query.set(String::new());
        if let Some(el) = input.get_untracked() {
            let _ = el.focus();
        }
    };

    view! {
        <div class="v5-cmd" data-open=move || open.get().to_string()>
            <label class="v5-cmd-search">
                <Icon name=IconName::Search size=22 />
                <input
                    node_ref=input
                    prop:value=move || query.get()
                    on:input=move |e| query.set(event_target_value(&e))
                    placeholder="Suchen oder Befehl …"
                    aria-label="Suchen"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-haspopup="listbox"
                    aria-controls=LIST_ID
                    aria-expanded=move || open.get().to_string()
                    aria-activedescendant=move || active.get().map(option_id)
                    inputmode="search"
                    enterkeyhint="search"
                    autocomplete="off"
                    spellcheck="false"
                    on:focus=move |_| {
                        focused.set(true);
                        if let Some(f) = on_focus {
                            f.run(());
                        }
                    }
                    on:blur=move |_| set_timeout(move || focused.set(false), BLUR_GRACE)
                    on:keydown=on_key
                />
                <Show when=move || query.with(|q| !q.is_empty())>
                    <button
                        type="button"
                        class="v5-cmd-clear"
                        aria-label="Suche leeren"
                        title="Suche leeren"
                        on:mousedown=|e: ev::MouseEvent| e.prevent_default()
                        on:click=clear
                    >
                        <Icon name=IconName::Close size=20 />
                    </button>
                </Show>
            </label>
            {children()}
        </div>
        <Show when=move || open.get()>
            <Results groups=groups active=active busy=busy on_pick=pick />
        </Show>
    }
}
