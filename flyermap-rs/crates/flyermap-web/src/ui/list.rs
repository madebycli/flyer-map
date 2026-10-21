//! The building blocks of lists and settings (port of `src/ui/controls.tsx`): [`ListGroup`] is a titled block of rows, [`ListRow`] one line
//! (icon, text, badge, chevron), [`SwitchRow`] an on/off setting. One row height, one radius; nothing moves when a state changes.
use super::icon::{Icon, IconName};
use leptos::prelude::*;

#[component]
pub fn ListGroup(
    // `optional_no_strip` + `into`: callers pass a text or an `Option` they already have
    #[prop(optional_no_strip, into)] title: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    view! {
        <section class="v5-group" aria-label=title>
            {title.map(|t| view! { <h3 class="v5-group-title">{t}</h3> })}
            <div class="v5-group-rows">{children()}</div>
        </section>
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RowTone {
    #[default]
    Default,
    Primary,
}

/// The row's class: `v5-grow`, plus `primary` for the accent tone.
pub fn row_class(tone: RowTone) -> &'static str {
    match tone {
        RowTone::Default => "v5-grow",
        RowTone::Primary => "v5-grow primary",
    }
}

/// A badge is shown for a non-empty text that is not `"0"` (the React row hides 0 and nothing).
pub fn badge_text(badge: Option<String>) -> Option<String> {
    badge.filter(|b| !b.is_empty() && b != "0")
}

/// One line that opens something. With `href` it is a link, otherwise a button; its accessible name is the label alone.
#[component]
pub fn ListRow(
    icon: IconName,
    #[prop(into)] label: String,
    #[prop(optional_no_strip, into)] hint: Option<&'static str>,
    #[prop(optional_no_strip, into)] badge: Option<String>,
    #[prop(default = true)] chevron: bool,
    #[prop(optional)] tone: RowTone,
    #[prop(optional, into)] href: Option<String>,
    #[prop(optional, into)] disabled: Signal<bool>,
    #[prop(optional, into)] on_click: Option<Callback<()>>,
) -> impl IntoView {
    let body = {
        let label = label.clone();
        view! {
            <span class="v5-row-ico"><Icon name=icon size=24 /></span>
            <span class="v5-row-text"><b>{label}</b>{hint.map(|h| view! { <small>{h}</small> })}</span>
            {badge_text(badge).map(|b| view! { <em class="v5-row-badge">{b}</em> })}
            {chevron.then(|| view! { <Icon name=IconName::Chevron size=20 class="v5-row-chev" /> })}
        }
    };
    let class = row_class(tone);
    match href {
        Some(href) => view! { <a class=class href=href aria-label=label>{body}</a> }.into_any(),
        None => view! {
            <button
                type="button"
                class=class
                aria-label=label
                disabled=move || disabled.get()
                on:click=move |_| {
                    if let Some(f) = on_click {
                        f.run(())
                    }
                }
            >
                {body}
            </button>
        }
        .into_any(),
    }
}

/// An on/off setting: the whole row is the switch (`role="switch"`, `aria-checked`).
#[component]
pub fn SwitchRow(
    icon: IconName,
    label: &'static str,
    #[prop(optional)] hint: Option<&'static str>,
    #[prop(into)] checked: Signal<bool>,
    #[prop(into)] on_change: Callback<bool>,
) -> impl IntoView {
    view! {
        <button
            type="button"
            class="v5-grow"
            role="switch"
            aria-checked=move || checked.get().to_string()
            on:click=move |_| on_change.run(!checked.get_untracked())
        >
            <span class="v5-row-ico"><Icon name=icon size=24 /></span>
            <span class="v5-row-text"><b>{label}</b>{hint.map(|h| view! { <small>{h}</small> })}</span>
            <span class="v5-switch" class:on=move || checked.get() aria-hidden="true"><i></i></span>
        </button>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_and_empty_badges_are_hidden() {
        assert_eq!(badge_text(None), None);
        assert_eq!(badge_text(Some("0".into())), None);
        assert_eq!(badge_text(Some(String::new())), None);
        assert_eq!(badge_text(Some("3".into())).as_deref(), Some("3"));
    }

    #[test]
    fn tones() {
        assert_eq!(row_class(RowTone::default()), "v5-grow");
        assert_eq!(row_class(RowTone::Primary), "v5-grow primary");
    }
}
