//! Dark or light: the `data-theme` attribute on `<html>` that `tokens.css` switches on, and the browser's `theme-color`.
use super::dom;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

impl Theme {
    /// What is stored: `"light"` means light, anything else (or nothing) means dark, as in `src/ui/theme.ts`.
    pub fn parse(stored: Option<&str>) -> Theme {
        if stored == Some("light") {
            Theme::Light
        } else {
            Theme::Dark
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Theme::Dark => "dark",
            Theme::Light => "light",
        }
    }

    /// The colour of the browser bar before the palette is applied (the static surface of `tokens.css`).
    pub fn static_surface(self) -> &'static str {
        match self {
            Theme::Dark => "#0f1514",
            Theme::Light => "#f5faf8",
        }
    }
}

/// Switch the page to this theme. The palette (`ui::palette::apply`) follows with the colours of the seed.
pub fn apply(theme: Theme) {
    // A page without a document has nothing to switch; nothing to report either.
    let _ = dom::set_root_attr("data-theme", theme.as_str());
    let _ = dom::set_theme_color(theme.static_surface());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_light_is_light() {
        assert_eq!(Theme::parse(Some("light")), Theme::Light);
        assert_eq!(Theme::parse(Some("dark")), Theme::Dark);
        assert_eq!(Theme::parse(Some("LIGHT")), Theme::Dark);
        assert_eq!(Theme::parse(None), Theme::Dark);
        assert_eq!(Theme::parse(Some(Theme::Light.as_str())), Theme::Light);
    }
}
