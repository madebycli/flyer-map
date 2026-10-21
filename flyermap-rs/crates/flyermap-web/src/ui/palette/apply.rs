//! Writes the roles of a seed into the page's tokens (inline on `<html>`, so they win over the static fallback of the stylesheet).
use super::scheme::scheme_for;
use crate::platform::{dom, Theme};

pub fn apply(seed: &str, theme: Theme) {
    let scheme = scheme_for(seed, theme);
    for (name, value) in scheme.iter() {
        let _ = dom::set_root_var(&format!("--{name}"), value);
    }
    if let Some(surface) = scheme.get("surface") {
        let _ = dom::set_theme_color(surface);
    }
}
