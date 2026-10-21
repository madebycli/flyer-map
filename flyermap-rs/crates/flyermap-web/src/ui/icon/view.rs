//! The icon element: an inline SVG that takes its colour from the text (`currentColor`), hidden from assistive tech (the control carries the name).
use super::table::IconName;
use leptos::prelude::*;

#[component]
pub fn Icon(
    /// A fixed icon or one that follows a signal (the cloud of the status pill).
    #[prop(into)]
    name: Signal<IconName>,
    #[prop(default = 24)] size: u32,
    /// Extra classes after `v5-icon`.
    #[prop(optional)]
    class: &'static str,
) -> impl IntoView {
    let class = if class.is_empty() { "v5-icon".to_string() } else { format!("v5-icon {class}") };
    view! {
        <svg
            class=class
            width=size
            height=size
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
            inner_html=move || name.get().markup()
        ></svg>
    }
}
