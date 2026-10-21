//! The bar at the top of the map (port of `src/v5/app/commandBar.tsx`), the one place for "where am I and where to": menu, search, status. It
//! never changes size. Typing opens the results as a card that floats under it; a tap on a result picks it and closes the card.
use super::{
    hit::{card_open, Hit},
    results::Results,
};
use crate::ui::icon::{Icon, IconName};
use leptos::{ev, html, prelude::*};
use std::time::Duration;

/// How long the card stays after the field loses focus, so a tap on a result still lands.
const BLUR_GRACE: Duration = Duration::from_millis(120);

#[component]
pub fn CommandBar(
    #[prop(into)] on_menu: Callback<()>,
    /// The search: called with the typed text while the card is open.
    #[prop(into)]
    search: Callback<String, Vec<Hit>>,
    #[prop(into)] on_pick: Callback<Hit>,
    /// Called when the field gets the focus (the app closes an open sheet then).
    #[prop(optional, into)]
    on_focus: Option<Callback<()>>,
    /// The status at the right end (the pill).
    children: Children,
) -> impl IntoView {
    let query = RwSignal::new(String::new());
    let focused = RwSignal::new(false);
    let input = NodeRef::<html::Input>::new();
    // `autocorrect` (Safari) is not among the attributes `view!` knows, and a name without a dash cannot be written as a custom one.
    Effect::new(move |_| {
        if let Some(el) = input.get() {
            let _ = el.set_attribute("autocorrect", "off");
        }
    });
    let open = Memo::new(move |_| query.with(|q| card_open(focused.get(), q)));
    let hits = Memo::new(move |_| {
        if open.get() {
            search.run(query.get())
        } else {
            Vec::new()
        }
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
    let on_key = move |e: ev::KeyboardEvent| match e.key().as_str() {
        "Enter" => {
            if let Some(first) = hits.get_untracked().into_iter().next() {
                pick(first);
            }
        }
        "Escape" => finish(),
        _ => {}
    };
    let clear = move |_| {
        query.set(String::new());
        if let Some(el) = input.get_untracked() {
            let _ = el.focus();
        }
    };

    view! {
        <div class="v5-cmd" data-open=move || open.get().to_string()>
            <button
                type="button"
                class="v5-cmd-btn"
                aria-label="Menü"
                title="Menü"
                on:click=move |_| {
                    finish();
                    on_menu.run(());
                }
            >
                <Icon name=IconName::Menu size=24 />
            </button>
            <label class="v5-cmd-search">
                <Icon name=IconName::Search size=22 />
                <input
                    node_ref=input
                    prop:value=move || query.get()
                    on:input=move |e| query.set(event_target_value(&e))
                    placeholder="Straße oder Adresse"
                    aria-label="Straße oder Adresse suchen"
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
            <Results hits=hits on_pick=pick />
        </Show>
    }
}
