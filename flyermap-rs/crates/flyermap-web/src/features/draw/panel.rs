//! The drawing panel: the same layout as the marking panel, in the same zone (above the mode button, on the thumb's side), with fixed places: the kind of
//! drawing (tiles), what to do next or what is wrong (one sentence), undo at the bottom (left for a right-handed person), confirm opposite. The sentence is
//! the only part that changes length; nothing around it moves.
use crate::{
    drawing::Kind,
    ui::{Icon, IconName},
};
use leptos::prelude::*;

pub fn kind_icon(kind: Kind) -> IconName {
    match kind {
        Kind::Free => IconName::Polygon,
        Kind::Connect => IconName::Link,
        Kind::Extend => IconName::Plus,
        Kind::Split => IconName::Cut,
    }
}

#[component]
pub fn DrawPanel(
    /// The kinds this person may draw (Teilen only with a main area to cut).
    kinds: Signal<Vec<Kind>>,
    #[prop(into)] kind: Signal<Kind>,
    /// What to do next, or why the drawing does not work; `bad` colours it as a warning.
    #[prop(into)]
    hint: Signal<String>,
    #[prop(into)] bad: Signal<bool>,
    /// How big the finished outline is.
    #[prop(into)]
    size: Signal<Option<String>>,
    #[prop(into)] confirm_label: Signal<String>,
    #[prop(into)] confirm_enabled: Signal<bool>,
    #[prop(into)] undo_enabled: Signal<bool>,
    #[prop(into)] on_kind: Callback<Kind>,
    #[prop(into)] on_undo: Callback<()>,
    #[prop(into)] on_confirm: Callback<()>,
) -> impl IntoView {
    view! {
        <section class="fm-panel fm-drawpanel" aria-label="Gebiet zeichnen" data-draw-kind=move || kind.get().key()>
            <div class="fm-slot" data-slot="kind" role="group" aria-label="Art" style:--n=move || kinds.with(Vec::len).to_string()>
                <For each=move || kinds.get() key=|k| *k let:k>
                    <button
                        type="button"
                        class="fm-tile"
                        data-kind=k.key()
                        aria-pressed=move || (kind.get() == k).to_string()
                        on:click=move |_| on_kind.run(k)
                    >
                        <Icon name=kind_icon(k) size=22 />
                        <span>{k.label()}</span>
                    </button>
                </For>
            </div>
            <div class="fm-slot" data-slot="hint" role="status">
                <p class="fm-ctx-line" class:warn=move || bad.get()>
                    <Icon name=move || if bad.get() { IconName::Warning } else { IconName::Info } size=18 />
                    <span>{move || hint.get()}</span>
                </p>
                {move || size.get().map(|s| view! { <b class="fm-draw-size">{s}</b> })}
            </div>
            <button type="button" class="fm-slot fm-undo" data-slot="undo" disabled=move || !undo_enabled.get() on:click=move |_| on_undo.run(())>
                <Icon name=IconName::Undo size=22 />
                <span>"Zurück"</span>
            </button>
            <button type="button" class="fm-slot fm-confirm" data-slot="confirm" disabled=move || !confirm_enabled.get() on:click=move |_| on_confirm.run(())>
                <Icon name=IconName::Check size=22 />
                <span>{move || confirm_label.get()}</span>
            </button>
        </section>
    }
}
