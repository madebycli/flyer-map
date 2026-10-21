//! Hilfe (port of `HelpSheet` in `src/v5/app/help.tsx`): a short introduction for the role, a search field and questions that open on tap.
use super::{
    model::{shown, HelpRole},
    topics::topic,
};
use crate::ui::{Hint, IconName, Sheet};
use leptos::prelude::*;

#[component]
pub fn HelpSheet(role: HelpRole, #[prop(into)] on_close: Callback<()>) -> impl IntoView {
    let query = RwSignal::new(String::new());
    let entries = Memo::new(move |_| query.with(|q| shown(role, q)));
    let t = topic(role);
    let list = move || {
        let list = entries.get();
        if list.is_empty() {
            return view! { <Hint icon=IconName::Info text="Dazu gibt es keine Frage. Versuch ein anderes Wort." /> }.into_any();
        }
        let items = list
            .into_iter()
            .map(|e| {
                view! {
                    <details class="v5-faqitem">
                        <summary>{e.q}</summary>
                        {e.a.iter().map(|line| view! { <p>{*line}</p> }).collect_view()}
                    </details>
                }
            })
            .collect_view();
        view! { <div class="v5-faq">{items}</div> }.into_any()
    };
    view! {
        <Sheet icon=IconName::Info title=t.title on_close=on_close>
            <div class="v5-helpintro">{t.intro.iter().map(|line| view! { <p>{*line}</p> }).collect_view()}</div>
            <input
                class="v5-input"
                type="search"
                placeholder="Frage suchen"
                aria-label="Fragen durchsuchen"
                autocomplete="off"
                prop:value=move || query.get()
                on:input=move |e| query.set(event_target_value(&e))
            />
            {list}
        </Sheet>
    }
}
