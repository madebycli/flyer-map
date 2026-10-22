//! The mode button: the one big button of the map, on the side of the thumb. A tap raises the tool's panel above it (marking, or drawing a
//! Gebiet when that is what is going on); a tap again puts the tool down. It shows the icon of the current mode and never moves.
use crate::ui::{Icon, IconName};
use leptos::prelude::*;

#[component]
pub fn ModeButton(
    /// The icon of the mode in use.
    #[prop(into)]
    icon: Signal<IconName>,
    /// A tool is up.
    #[prop(into)]
    active: Signal<bool>,
    #[prop(into)] label: Signal<String>,
    /// Marking is not possible here (nothing writable): the button is not shown.
    #[prop(into)]
    available: Signal<bool>,
    #[prop(into)] on_click: Callback<()>,
) -> impl IntoView {
    view! {
        <Show when=move || available.get()>
            <button
                type="button"
                class="fm-mode"
                data-mode-button
                aria-label=move || label.get()
                title=move || label.get()
                aria-pressed=move || active.get().to_string()
                on:click=move |_| on_click.run(())
            >
                <Icon name=icon size=30 />
            </button>
        </Show>
    }
}
