//! The live strip under the command bar: who is out right now. A tap on a chip follows that Lauf (the map goes there); a second tap lets go.
//! It takes no room when nobody is out, and replaces the old "Admin / aktuelle Runs".
use super::model::Chip;
use leptos::prelude::*;

#[component]
pub fn LiveStrip(
    #[prop(into)] chips: Signal<Vec<Chip>>,
    #[prop(into)] following: Signal<Option<String>>,
    #[prop(into)] on_pick: Callback<String>,
) -> impl IntoView {
    view! {
        <Show when=move || chips.with(|c| !c.is_empty())>
            <div class="fm-live" role="group" aria-label="Im Einsatz">
                <span class="fm-live-tag" aria-hidden="true"><i></i>"Live"</span>
                <div class="fm-live-chips">
                    <For each=move || chips.get() key=|c| (c.id.clone(), c.detail.clone(), c.title.clone()) let:chip>
                        {
                            let (id, pressed_id) = (chip.id.clone(), chip.id.clone());
                            let label = format!("{}, {}", chip.title, chip.detail);
                            view! {
                                <button
                                    type="button"
                                    class="fm-chip"
                                    style:--c=chip.color.clone()
                                    aria-label=label
                                    aria-pressed=move || (following.get().as_deref() == Some(pressed_id.as_str())).to_string()
                                    on:click=move |_| on_pick.run(id.clone())
                                >
                                    <span class="fm-chip-dot" aria-hidden="true">{chip.initials.clone()}</span>
                                    <span class="fm-chip-text"><b>{chip.title.clone()}</b><small>{chip.detail.clone()}</small></span>
                                </button>
                            }
                        }
                    </For>
                </div>
            </div>
        </Show>
    }
}
