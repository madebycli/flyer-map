//! Vorlagen (port of `TemplatesSheet` in `src/v5/app/panels.tsx`): load an Aktions-Vorlage from a file, or keep the current Gebiete and Gruppen
//! as a file. Loading and saving follow with the store (M6); the rows are here so the way to them is the final one.
use crate::ui::{Hint, IconName, ListGroup, ListRow, Sheet};
use leptos::prelude::*;

#[component]
pub fn TemplatesSheet(
    can_load: bool,
    can_save: bool,
    #[prop(into)] on_load: Callback<()>,
    #[prop(into)] on_save: Callback<()>,
    #[prop(into)] on_back: Callback<()>,
    #[prop(into)] on_close: Callback<()>,
) -> impl IntoView {
    view! {
        <Sheet icon=IconName::Upload title="Vorlagen" on_back=on_back on_close=on_close>
            <Hint text="Eine Vorlage hält Gebiete und Gruppen einer Aktion fest, ohne Personen und ohne Fortschritt. Damit lässt sich eine Aktion schnell wieder aufsetzen." />
            <ListGroup>
                {can_load.then(|| view! {
                    <ListRow icon=IconName::Upload label="Vorlage laden" hint="Datei wählen, vorher wird gezeigt, was sich ändert" on_click=on_load />
                })}
                {can_save.then(|| view! {
                    <ListRow icon=IconName::Download label="Als Vorlage speichern" hint="Gebiete und Gruppen dieser Aktion als Datei" on_click=on_save />
                })}
            </ListGroup>
        </Sheet>
    }
}
