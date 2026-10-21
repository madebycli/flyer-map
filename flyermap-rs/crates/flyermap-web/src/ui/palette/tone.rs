//! The colour of a tonal palette at a tone. A tone is a CIE lightness (L*), so two tones 40 apart keep their contrast whatever the hue. The colour
//! is found in OKLCH: the hue and chroma of the palette, the lightness searched until the luminance matches the tone, the chroma pulled back
//! until the colour fits into sRGB.
use super::color::{hex, in_gamut, luminance, oklch_to_linear, tone_to_y, Rgb};

/// The largest chroma ≤ `chroma` that is inside sRGB at this lightness and hue.
fn fit_chroma(l: f64, chroma: f64, hue: f64) -> f64 {
    if in_gamut(oklch_to_linear(l, chroma, hue)) {
        return chroma;
    }
    let (mut lo, mut hi) = (0.0, chroma);
    for _ in 0..18 {
        let mid = (lo + hi) / 2.0;
        if in_gamut(oklch_to_linear(l, mid, hue)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// `#rrggbb` of the palette (`hue` in degrees, OKLCH `chroma`) at `tone` 0..100.
pub fn tone_color(hue: f64, chroma: f64, tone: f64) -> String {
    if tone <= 0.0 {
        return "#000000".into();
    }
    if tone >= 100.0 {
        return "#ffffff".into();
    }
    let target = tone_to_y(tone);
    let (mut lo, mut hi) = (0.0, 1.0);
    let mut best: Rgb = [0.0; 3];
    for _ in 0..26 {
        let l = (lo + hi) / 2.0;
        best = oklch_to_linear(l, fit_chroma(l, chroma, hue), hue);
        if luminance(best) < target {
            lo = l;
        } else {
            hi = l;
        }
    }
    hex(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::palette::color::{contrast, parse_hex};

    #[test]
    fn ends_are_black_and_white() {
        assert_eq!(tone_color(120.0, 0.1, 0.0), "#000000");
        assert_eq!(tone_color(120.0, 0.1, 100.0), "#ffffff");
    }

    #[test]
    fn tones_get_lighter() {
        let y = |t| luminance(parse_hex(&tone_color(200.0, 0.12, t)).unwrap());
        assert!(y(20.0) < y(40.0) && y(40.0) < y(80.0) && y(80.0) < y(95.0));
    }

    #[test]
    fn forty_tones_apart_is_readable_whatever_the_hue() {
        for hue in [0.0, 60.0, 120.0, 180.0, 240.0, 300.0] {
            let ratio =
                contrast(&tone_color(hue, 0.15, 40.0), &tone_color(hue, 0.15, 90.0)).unwrap();
            assert!(ratio >= 4.5, "hue {hue}: {ratio}");
        }
    }
}
