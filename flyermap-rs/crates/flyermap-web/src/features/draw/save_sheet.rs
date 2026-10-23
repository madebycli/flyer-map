//! The sheet that names a drawn Gebiet and says which Gruppe works in it, before it is stored. One text field, one choice among the Gruppen the person may draw
//! for, one button. A refusal of the server stands in the sheet in words (nothing is lost: the drawing is still there behind it).
use crate::{
    drawing::Kind,
    ui::{Button, ButtonVariant, Icon, IconName, Sheet, SheetFooter},
};
use leptos::prelude::*;

/// A Gruppe the new Gebiet can go to.
#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[component]
pub fn SaveSheet(
    kind: Kind,
    /// How big it is: `ca. 2,4 ha`.
    size: String,
    #[prop(into)] name: RwSignal<String>,
    choices: Vec<Choice>,
    #[prop(into)] gruppe: RwSignal<Option<String>>,
    /// The server's answer, when it refused.
    #[prop(into)]
    error: Signal<Option<String>>,
    #[prop(into)] saving: Signal<bool>,
    #[prop(into)] on_save: Callback<()>,
    /// Back to the drawing.
    #[prop(into)]
    on_back: Callback<()>,
) -> impl IntoView {
    let title = if kind == Kind::Split { "Teilgebiet anlegen" } else { "Gebiet anlegen" };
    let valid = Memo::new(move |_| name.with(|n| !n.trim().is_empty()));
    let rows = choices
        .into_iter()
        .map(|c| {
            let id = c.id.clone();
            let on = Memo::new({
                let id = id.clone();
                move |_| gruppe.with(|g| g.as_deref() == Some(id.as_str()))
            });
            view! {
                <button
                    type="button"
                    class="fm-toggle fm-choice"
                    role="radio"
                    data-gruppe=c.id.clone()
                    aria-checked=move || on.get().to_string()
                    aria-pressed=move || on.get().to_string()
                    style:--c=c.color.clone()
                    on:click=move |_| gruppe.set(Some(id.clone()))
                >
                    <i class="fm-dot" aria-hidden="true"></i>
                    <span>{c.name}</span>
                </button>
            }
        })
        .collect_view();
    view! {
        <Sheet icon=IconName::Polygon title=title on_close=on_back>
            <p class="fm-status-line" data-role="draw-size">{size}</p>
            <label class="fm-field">
                <span>"Name"</span>
                <input
                    class="v5-input"
                    data-field="name"
                    type="text"
                    autocomplete="off"
                    maxlength="60"
                    prop:value=move || name.get()
                    on:input=move |e| name.set(event_target_value(&e))
                />
            </label>
            <div class="fm-field" role="radiogroup" aria-label="Gruppe">
                <span>"Gruppe"</span>
                <div class="fm-choices">{rows}</div>
            </div>
            {move || error.get().map(|text| view! { <p class="v5-hint warn" role="alert"><Icon name=IconName::Warning size=20 />{text}</p> })}
            <SheetFooter slot>
                <Button label="Speichern" variant=ButtonVariant::Primary icon=IconName::Check disabled=Signal::derive(move || !valid.get() || saving.get()) on_click=on_save />
                <Button label="Zurück zum Zeichnen" variant=ButtonVariant::Quiet on_click=on_back />
            </SheetFooter>
        </Sheet>
    }
}
