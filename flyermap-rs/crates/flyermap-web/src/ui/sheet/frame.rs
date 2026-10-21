//! The bottom sheet every screen uses (port of `SheetFrame` in `src/v5/app/sheet.tsx`): handle, header (badge or back arrow, title, meta line,
//! actions, close), an optional toolbar, the scrolling body and an optional footer. Header, toolbar and footer stay put while the body scrolls; the
//! sheet sits above a touch keyboard (`--kb`, `--vvh` from `platform::viewport`). The handle is a real control: drag it down (or tap it) and the
//! sheet shrinks to its header, so the map is free without losing the place; drag it up (or tap again) and it is back. Closing is the X's job.
use super::drag::{after_gesture, follow_offset};
use crate::ui::{
    button::{IconButton, IconButtonVariant},
    icon::{Icon, IconName},
};
use leptos::{ev, html, prelude::*};
use wasm_bindgen::JsCast;

/// The line under the title (counts, the role).
#[slot]
pub struct SheetMeta {
    children: Children,
}

/// Buttons between the title and the close cross.
#[slot]
pub struct SheetActions {
    children: Children,
}

/// Pinned under the header while the body scrolls: a search field, filters.
#[slot]
pub struct SheetToolbar {
    children: Children,
}

/// Pinned at the bottom: the one action the sheet is for.
#[slot]
pub struct SheetFooter {
    children: Children,
}

fn set_style(sheet: &NodeRef<html::Section>, transition: &str, transform: &str) {
    if let Some(el) = sheet.get_untracked() {
        let style = el.style();
        let _ = style.set_property("transition", transition);
        let _ = style.set_property("transform", transform);
    }
}

#[component]
pub fn Sheet(
    /// The badge in front of the title (a page one level down shows the back arrow instead).
    icon: IconName,
    #[prop(into)] title: String,
    #[prop(into)] on_close: Callback<()>,
    /// A page one level down: the back arrow takes the place of the badge and returns to the page above.
    #[prop(optional, into)]
    on_back: Option<Callback<()>>,
    #[prop(default = "Zurück")] back_label: &'static str,
    #[prop(optional)] sheet_meta: Option<SheetMeta>,
    #[prop(optional)] sheet_actions: Option<SheetActions>,
    #[prop(optional)] sheet_toolbar: Option<SheetToolbar>,
    #[prop(optional)] sheet_footer: Option<SheetFooter>,
    children: Children,
) -> impl IntoView {
    let small = RwSignal::new(false);
    let sheet = NodeRef::<html::Section>::new();
    // Where the finger went down and how far it moved since.
    let drag = StoredValue::new(None::<(f64, f64)>);

    let on_down = move |e: ev::PointerEvent| {
        drag.set_value(Some((f64::from(e.client_y()), 0.0)));
        if let Some(target) = e.current_target().and_then(|t| t.dyn_into::<web_sys::Element>().ok()) {
            let _ = target.set_pointer_capture(e.pointer_id());
        }
    };
    let on_move = move |e: ev::PointerEvent| {
        let Some((y, _)) = drag.get_value() else { return };
        let dy = f64::from(e.client_y()) - y;
        drag.set_value(Some((y, dy)));
        if let Some(offset) = follow_offset(small.get_untracked(), dy) {
            set_style(&sheet, "none", &format!("translateY({offset}px)"));
        }
    };
    let on_up = move |_: ev::PointerEvent| {
        let gesture = drag.get_value();
        drag.set_value(None);
        set_style(&sheet, "", "");
        if let Some((_, dy)) = gesture {
            small.update(|s| *s = after_gesture(*s, dy));
        }
    };
    let on_cancel = move |_: ev::PointerEvent| {
        drag.set_value(None);
        set_style(&sheet, "", "");
    };
    let on_key = move |e: ev::KeyboardEvent| {
        if e.key() == "Enter" || e.key() == " " {
            e.prevent_default();
            small.update(|s| *s = !*s);
        }
    };

    let lead = match on_back {
        Some(back) => view! {
            <IconButton icon=IconName::Back label=back_label variant=IconButtonVariant::Tonal class="v5-back" on_click=back />
        }
        .into_any(),
        None => view! { <span class="v5-badge"><Icon name=icon size=26 /></span> }.into_any(),
    };
    let label = title.clone();
    view! {
        <section node_ref=sheet class="v5-sheet" class:small=move || small.get() aria-label=label>
            <div
                class="v5-handle"
                role="button"
                tabindex="0"
                aria-label=move || if small.get() { "Fenster vergrößern" } else { "Fenster verkleinern" }
                aria-expanded=move || (!small.get()).to_string()
                on:pointerdown=on_down
                on:pointermove=on_move
                on:pointerup=on_up
                on:pointercancel=on_cancel
                on:keydown=on_key
            >
                <i aria-hidden="true"></i>
            </div>
            <header>
                {lead}
                <div class="v5-head-text">
                    <h2>{title}</h2>
                    {sheet_meta.map(|m| view! { <div class="v5-meta">{(m.children)()}</div> })}
                </div>
                {sheet_actions.map(|a| (a.children)())}
                <IconButton icon=IconName::Close label="Schließen" variant=IconButtonVariant::Tonal on_click=on_close />
            </header>
            {sheet_toolbar.map(|t| view! { <div class="v5-sheet-toolbar">{(t.children)()}</div> })}
            <div class="v5-sheet-body">{children()}</div>
            {sheet_footer.map(|f| view! { <footer class="v5-sheet-footer">{(f.children)()}</footer> })}
        </section>
    }
}
