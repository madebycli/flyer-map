//! A choice of a few options in one row (port of `Segmented` in `src/ui/kit.tsx`): a named group of buttons, the chosen one `aria-pressed`.
use super::icon::{Icon, IconName};
use leptos::prelude::*;

#[derive(Clone, Debug, PartialEq)]
pub struct SegOption<T> {
    pub value: T,
    pub label: &'static str,
    pub icon: Option<IconName>,
}

impl<T> SegOption<T> {
    pub fn new(value: T, label: &'static str, icon: IconName) -> SegOption<T> {
        SegOption { value, label, icon: Some(icon) }
    }

    pub fn text(value: T, label: &'static str) -> SegOption<T> {
        SegOption { value, label, icon: None }
    }
}

#[component]
pub fn Segmented<T>(
    /// The group's accessible name.
    label: &'static str,
    #[prop(into)] value: Signal<T>,
    options: Vec<SegOption<T>>,
    #[prop(into)] on_change: Callback<T>,
) -> impl IntoView
where
    T: Clone + PartialEq + Send + Sync + 'static,
{
    let buttons = options
        .into_iter()
        .map(|option| {
            let SegOption { value: own, label, icon } = option;
            let chosen = {
                let own = own.clone();
                Memo::new(move |_| value.with(|v| *v == own))
            };
            view! {
                <button
                    type="button"
                    class:on=move || chosen.get()
                    aria-pressed=move || chosen.get().to_string()
                    on:click=move |_| on_change.run(own.clone())
                >
                    {icon.map(|name| view! { <Icon name=name size=20 /> })}
                    {label}
                </button>
            }
        })
        .collect_view();
    view! { <div class="ui-seg" role="group" aria-label=label>{buttons}</div> }
}
