//! The map zone (`.v5-map`, named "Karte" as in the React app) with the stand-in drawing.
use super::drawing::{svg_markup, HouseDot, StreetLine, SIZE};
use crate::platform::Theme;
use leptos::prelude::*;

#[component]
pub fn MapStub(
    streets: Vec<StreetLine>,
    houses: Vec<HouseDot>,
    #[prop(into)] theme: Signal<Theme>,
) -> impl IntoView {
    let markup = Memo::new(move |_| svg_markup(&streets, &houses, theme.get()));
    view! {
        <div class="v5-map v5-map-stub" aria-label="Karte">
            <svg
                viewBox=format!("0 0 {SIZE} {SIZE}")
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                focusable="false"
                inner_html=move || markup.get()
            ></svg>
        </div>
    }
}
