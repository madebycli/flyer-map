//! The short modal container: an [`Overlay`] over the whole app holding a [`Card`] (title, a sentence, its actions). For the rare things
//! that need an answer before anything else (and the loading pages). Everything longer is a sheet.
use super::icon::{Icon, IconName};
use leptos::prelude::*;

/// Covers the app with the surface colour; its content sits in the middle.
#[component]
pub fn Overlay(#[prop(optional)] label: Option<&'static str>, children: Children) -> impl IntoView {
    view! {
        <div class="v5-overlay" role="dialog" aria-modal="true" aria-label=label>
            {children()}
        </div>
    }
}

#[component]
pub fn Card(
    #[prop(optional)] icon: Option<IconName>,
    #[prop(into)] title: String,
    #[prop(optional, into)] text: Option<String>,
    children: Children,
) -> impl IntoView {
    view! {
        <section class="v5-card">
            {icon.map(|name| view! { <span class="v5-badge big"><Icon name=name size=32 /></span> })}
            <h2>{title}</h2>
            {text.map(|t| view! { <p>{t}</p> })}
            {children()}
        </section>
    }
}

/// A sentence with an icon in front (`.v5-hint`).
#[component]
pub fn Hint(
    #[prop(default = IconName::Info)] icon: IconName,
    #[prop(into)] text: String,
) -> impl IntoView {
    view! { <p class="v5-hint"><Icon name=icon size=20 />{text}</p> }
}
