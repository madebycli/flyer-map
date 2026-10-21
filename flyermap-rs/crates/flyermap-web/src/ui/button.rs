//! Buttons: one height (`--ctl`), one radius family. A [`Button`] has words (and maybe an icon), an [`IconButton`] is a square with an icon and a
//! name for assistive tech. Classes are those of `components.css`, so the look is the React app's.
use super::icon::{Icon, IconName};
use leptos::prelude::*;

/// Words on a pill: `v5-btn`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// The neutral tonal button.
    #[default]
    Tonal,
    /// The one action a sheet is for.
    Primary,
    /// Deleting, ending.
    Danger,
    /// Transparent, for a secondary choice next to a primary one.
    Quiet,
}

impl ButtonVariant {
    pub fn class(self) -> &'static str {
        match self {
            ButtonVariant::Tonal => "v5-btn",
            ButtonVariant::Primary => "v5-btn primary",
            ButtonVariant::Danger => "v5-btn danger",
            ButtonVariant::Quiet => "v5-btn quiet",
        }
    }
}

/// A square icon control.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum IconButtonVariant {
    /// Transparent, in a header or a toast: `v5-icon-btn`.
    #[default]
    Plain,
    /// On a tonal surface (the close cross of a sheet): `v5-icon-btn tonal`.
    Tonal,
    /// The filled accent square (confirm): `v5-go`.
    Filled,
    /// Floating over the map with a shadow (zoom, locate): `v5-sq`.
    Floating,
}

impl IconButtonVariant {
    pub fn class(self) -> &'static str {
        match self {
            IconButtonVariant::Plain => "v5-icon-btn",
            IconButtonVariant::Tonal => "v5-icon-btn tonal",
            IconButtonVariant::Filled => "v5-go",
            IconButtonVariant::Floating => "v5-sq",
        }
    }
}

#[component]
pub fn Button(
    #[prop(into)] label: String,
    #[prop(optional)] variant: ButtonVariant,
    #[prop(optional, into)] icon: Option<IconName>,
    #[prop(optional, into)] disabled: Signal<bool>,
    #[prop(into)] on_click: Callback<()>,
) -> impl IntoView {
    view! {
        <button type="button" class=variant.class() disabled=move || disabled.get() on:click=move |_| on_click.run(())>
            {icon.map(|name| view! { <Icon name=name size=20 /> })}
            {label}
        </button>
    }
}

#[component]
pub fn IconButton(
    icon: IconName,
    /// The accessible name, also the tooltip.
    label: &'static str,
    #[prop(optional)] variant: IconButtonVariant,
    /// Extra classes (for example `v5-back`).
    #[prop(optional)]
    class: &'static str,
    #[prop(default = 24)] size: u32,
    #[prop(into)] on_click: Callback<()>,
) -> impl IntoView {
    let class = if class.is_empty() { variant.class().to_string() } else { format!("{} {class}", variant.class()) };
    view! {
        <button type="button" class=class aria-label=label title=label on:click=move |_| on_click.run(())>
            <Icon name=icon size=size />
        </button>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_use_the_classes_of_the_stylesheet() {
        assert_eq!(ButtonVariant::default().class(), "v5-btn");
        assert_eq!(ButtonVariant::Primary.class(), "v5-btn primary");
        assert_eq!(IconButtonVariant::Tonal.class(), "v5-icon-btn tonal");
        assert_eq!(IconButtonVariant::Floating.class(), "v5-sq");
    }
}
