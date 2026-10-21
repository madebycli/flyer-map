//! A short message under the bar (`.v5-toast`) that goes away on its own or with its button.
use super::{
    button::{IconButton, IconButtonVariant},
    icon::{Icon, IconName},
};
use leptos::prelude::*;

#[component]
pub fn Toast(#[prop(into)] text: String, #[prop(default = IconName::Check)] icon: IconName, #[prop(into)] on_dismiss: Callback<()>) -> impl IntoView {
    view! {
        <div class="v5-toast" role="status">
            <Icon name=icon size=22 />
            <span>{text}</span>
            <IconButton icon=IconName::Close label="OK" variant=IconButtonVariant::Plain size=20 on_click=on_dismiss />
        </div>
    }
}
