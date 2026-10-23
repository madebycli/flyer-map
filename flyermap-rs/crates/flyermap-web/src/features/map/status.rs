//! A slim line under the bar while the map data is being prepared, and what went wrong when it could not be.
use crate::{
    session::FieldState,
    ui::{Icon, IconName},
};
use leptos::prelude::*;

/// "Straßen und Häuser werden vorbereitet (2 von 4)".
pub fn loading_text(done: usize, total: usize) -> String {
    if total == 0 {
        "Straßen und Häuser werden vorbereitet …".into()
    } else {
        format!("Straßen und Häuser werden vorbereitet ({done} von {total})")
    }
}

#[component]
pub fn FieldStatus(#[prop(into)] state: Signal<FieldState>, #[prop(into)] on_retry: Callback<()>) -> impl IntoView {
    view! {
        {move || match state.get() {
            FieldState::Loading { done, total } => Some(
                view! {
                    <div class="fm-fieldnote" role="status" data-field="loading">
                        <i class="fm-fieldnote-bar" aria-hidden="true"></i>
                        <span>{loading_text(done, total)}</span>
                    </div>
                }
                .into_any(),
            ),
            FieldState::Failed { message, code } => Some(
                view! {
                    <div class="fm-fieldnote warn" role="alert" data-field="failed" data-code=code>
                        <Icon name=IconName::Warning size=20 />
                        <span>{message}</span>
                        <button type="button" on:click=move |_| on_retry.run(())>"Noch einmal"</button>
                    </div>
                }
                .into_any(),
            ),
            FieldState::Idle | FieldState::Ready => None,
        }}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loading_line_counts_the_units() {
        assert_eq!(loading_text(0, 0), "Straßen und Häuser werden vorbereitet …");
        assert_eq!(loading_text(2, 4), "Straßen und Häuser werden vorbereitet (2 von 4)");
    }
}
