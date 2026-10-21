//! The short modal cards of the shell (an [`Overlay`] with a [`Card`]).
use super::{
    shell::{Action, Dialog},
    state::AppState,
};
use crate::{
    platform::dom,
    ui::{Button, ButtonVariant, Card, IconName, Overlay},
};
use leptos::prelude::*;

/// The organiser pages of the React app.
const ADMIN_URL: &str = "/login";

pub fn dialog_view(state: AppState, dialog: Dialog) -> impl IntoView {
    match dialog {
        Dialog::Admin => view! {
            <Overlay label="Verwaltung">
                <Card
                    icon=IconName::Shield
                    title="Verwaltung"
                    text="Alle Aktionen, Konten und Einstellungen der Organisation liegen noch in der bisherigen Oberfläche."
                >
                    <div class="v5-footer-actions">
                        <Button label="Abbrechen" on_click=state.on(Action::CloseDialog) />
                        <Button label="Öffnen" variant=ButtonVariant::Primary icon=IconName::Exit on_click=move |_| dom::navigate(ADMIN_URL) />
                    </div>
                </Card>
            </Overlay>
        },
    }
}
