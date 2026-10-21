//! Material 3 roles from one seed colour, named as the CSS tokens of `tokens.css` (without the leading `--`). Port of `schemeFor` in
//! `src/ui/palette.ts`: same palettes, same tones, same order.
use super::{
    color::{from_linear, oklch, parse_hex},
    seeds::DEFAULT_SEED,
    tone::tone_color,
};
use crate::platform::Theme;

#[derive(Clone, Debug, PartialEq)]
pub struct Scheme(Vec<(&'static str, String)>);

impl Scheme {
    pub fn get(&self, role: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(name, _)| *name == role)
            .map(|(_, value)| value.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&'static str, &str)> {
        self.0.iter().map(|(name, value)| (*name, value.as_str()))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// The roles for this seed (`#rrggbb`; anything else falls back to the default seed) in this theme.
pub fn scheme_for(seed: &str, theme: Theme) -> Scheme {
    let rgb = parse_hex(seed)
        .or_else(|| parse_hex(DEFAULT_SEED))
        .unwrap_or([0.0; 3]);
    let (h, c) = oklch(rgb);
    let primary = |t| tone_color(h, c.clamp(0.11, 0.2), t);
    let secondary = |t| tone_color(h, 0.04, t);
    let tertiary = |t| tone_color((h + 60.0) % 360.0, 0.075, t);
    let neutral = |t| tone_color(h, 0.008, t);
    let variant = |t| tone_color(h, 0.016, t);
    let error = |t| tone_color(29.0, 0.2, t);
    let dark = theme == Theme::Dark;
    let glass = {
        let v = parse_hex(&neutral(if dark { 12.0 } else { 94.0 })).unwrap_or([0.0; 3]);
        let q = |x: f64| (from_linear(x) * 255.0).round() as i64;
        format!(
            "rgb({} {} {} / {}%)",
            q(v[0]),
            q(v[1]),
            q(v[2]),
            if dark { 94 } else { 95 }
        )
    };
    let white = || "#ffffff".to_string();
    let roles: Vec<(&'static str, String)> = if dark {
        vec![
            ("surface", neutral(6.0)),
            ("surface-1", neutral(10.0)),
            ("surface-2", neutral(12.0)),
            ("surface-3", neutral(17.0)),
            ("surface-4", neutral(22.0)),
            ("glass", glass),
            ("on", neutral(90.0)),
            ("on-var", variant(80.0)),
            ("outline", variant(60.0)),
            ("outline-var", variant(30.0)),
            ("primary", primary(80.0)),
            ("on-primary", primary(20.0)),
            ("primary-container", primary(30.0)),
            ("on-primary-container", primary(90.0)),
            ("secondary", secondary(80.0)),
            ("on-secondary", secondary(20.0)),
            ("secondary-container", secondary(30.0)),
            ("on-secondary-container", secondary(90.0)),
            ("tertiary", tertiary(80.0)),
            ("on-tertiary", tertiary(20.0)),
            ("tertiary-container", tertiary(30.0)),
            ("on-tertiary-container", tertiary(90.0)),
            ("error", error(80.0)),
            ("on-error", error(20.0)),
            ("error-container", error(30.0)),
            ("on-error-container", error(90.0)),
            ("inverse", neutral(90.0)),
            ("on-inverse", neutral(20.0)),
        ]
    } else {
        vec![
            ("surface", neutral(98.0)),
            ("surface-1", neutral(96.0)),
            ("surface-2", neutral(94.0)),
            ("surface-3", neutral(92.0)),
            ("surface-4", neutral(90.0)),
            ("glass", glass),
            ("on", neutral(10.0)),
            ("on-var", variant(30.0)),
            ("outline", variant(50.0)),
            ("outline-var", variant(80.0)),
            ("primary", primary(40.0)),
            ("on-primary", white()),
            ("primary-container", primary(90.0)),
            ("on-primary-container", primary(10.0)),
            ("secondary", secondary(40.0)),
            ("on-secondary", white()),
            ("secondary-container", secondary(90.0)),
            ("on-secondary-container", secondary(10.0)),
            ("tertiary", tertiary(40.0)),
            ("on-tertiary", white()),
            ("tertiary-container", tertiary(90.0)),
            ("on-tertiary-container", tertiary(10.0)),
            ("error", error(40.0)),
            ("on-error", white()),
            ("error-container", error(90.0)),
            ("on-error-container", error(10.0)),
            ("inverse", neutral(20.0)),
            ("on-inverse", neutral(95.0)),
        ]
    };
    Scheme(roles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::palette::{color::contrast, seeds::SEEDS};

    #[test]
    fn every_seed_has_readable_text_on_its_surfaces_and_buttons() {
        for seed in SEEDS {
            for theme in [Theme::Dark, Theme::Light] {
                let s = scheme_for(seed.hex, theme);
                assert_eq!(s.len(), 28);
                let pair =
                    |a: &str, b: &str| contrast(s.get(a).unwrap(), s.get(b).unwrap()).unwrap();
                assert!(pair("on", "surface") >= 7.0, "{} {theme:?}", seed.name);
                assert!(
                    pair("on-primary", "primary") >= 4.5,
                    "{} {theme:?}",
                    seed.name
                );
                assert!(
                    pair("on-primary-container", "primary-container") >= 4.5,
                    "{} {theme:?}",
                    seed.name
                );
            }
        }
    }

    #[test]
    fn a_bad_seed_is_the_default() {
        assert_eq!(
            scheme_for("nonsense", Theme::Dark),
            scheme_for(DEFAULT_SEED, Theme::Dark)
        );
    }

    #[test]
    fn light_and_dark_differ() {
        let (d, l) = (
            scheme_for("#2f6bd8", Theme::Dark),
            scheme_for("#2f6bd8", Theme::Light),
        );
        assert_ne!(d.get("primary"), l.get("primary"));
        assert!(
            d.get("glass").unwrap().ends_with("/ 94%)")
                && l.get("glass").unwrap().ends_with("/ 95%)")
        );
    }
}
