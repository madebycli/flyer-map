//! The root: provides the state and shows what the start allows: the loading page, the way in for a device without access, the error card, or the
//! app itself.
use super::{frame::Frame, state::AppState};
use crate::{
    session::Phase,
    ui::{Button, ButtonVariant, Card, IconName, Overlay},
};
use leptos::prelude::*;

#[component]
pub fn App(state: AppState) -> impl IntoView {
    provide_context(state);
    let phase = state.session.phase;
    move || match phase.get() {
        Phase::Ready => view! { <Frame state=state /> }.into_any(),
        Phase::Starting => view! {
            <div class="v5-root">
                <Overlay label="Wird geladen">
                    <div class="v5-loadingpage" role="status">
                        <img src="logo.svg" alt="" width="112" height="112" />
                        <p>"Aktion wird geladen …"</p>
                        <i class="v5-loadingbar" aria-hidden="true"></i>
                    </div>
                </Overlay>
            </div>
        }
        .into_any(),
        Phase::NeedsJoin => view! { <div class="v5-root">{super::join::screen(state)}</div> }.into_any(),
        Phase::Failed { message, code } => view! {
            <div class="v5-root">
                <Overlay label="Fehler">
                    <Card icon=IconName::Warning title="Das hat nicht geklappt" text=message>
                        <small class="v5-muted">{code}</small>
                        <Button label="Noch einmal" variant=ButtonVariant::Primary on_click=move |()| state.session.start() />
                    </Card>
                </Overlay>
            </div>
        }
        .into_any(),
    }
}
