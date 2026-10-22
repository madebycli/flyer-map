//! The map zone (`.v5-map`, named "Karte") with the stand-in drawing: a tap on a Gebiet picks it.
use super::drawing::{shapes, SIZE};
use crate::model::Gebiet;
use leptos::prelude::*;

#[component]
pub fn MapStub(#[prop(into)] gebiete: Signal<Vec<Gebiet>>, #[prop(into)] on_pick: Callback<String>) -> impl IntoView {
    let shapes = Memo::new(move |_| gebiete.with(|g| shapes(g)));
    view! {
        <div class="v5-map v5-map-stub" aria-label="Karte">
            <svg viewBox=format!("0 0 {SIZE} {SIZE}") preserveAspectRatio="xMidYMid slice" focusable="false">
                <For each=move || shapes.get() key=|s| (s.id.clone(), s.points.clone()) let:shape>
                    {
                        let id = shape.id.clone();
                        view! {
                            <polygon
                                class="fm-stub-gebiet"
                                data-gebiet=shape.id.clone()
                                points=shape.points.clone()
                                style:--c=shape.color.clone()
                                on:click=move |_| on_pick.run(id.clone())
                            />
                        }
                    }
                </For>
            </svg>
        </div>
    }
}
