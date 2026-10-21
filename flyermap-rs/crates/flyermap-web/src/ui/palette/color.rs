//! Colour maths for the palette: sRGB transfer, OKLab/OKLCH, relative luminance, hex. A line-by-line port of `src/ui/palette.ts`, so the
//! same seed gives the same hex codes in both apps (checked against vectors from the TypeScript code in `tests/palette_vectors.rs`).

/// Linear-light sRGB, each channel nominally 0..1 (outside means out of gamut).
pub type Rgb = [f64; 3];

pub fn to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub fn from_linear(c: f64) -> f64 {
    if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

pub fn oklch_to_linear(l: f64, c: f64, h_deg: f64) -> Rgb {
    let h = h_deg * std::f64::consts::PI / 180.0;
    let (a, b) = (c * h.cos(), c * h.sin());
    let l_ = (l + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m_ = (l - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s_ = (l - 0.0894841775 * a - 1.2914855480 * b).powi(3);
    [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    ]
}

pub fn in_gamut(rgb: Rgb) -> bool {
    rgb.iter().all(|c| (-0.0005..=1.0005).contains(c))
}

pub fn luminance(rgb: Rgb) -> f64 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/// Relative luminance Y (0..1) of CIE lightness L* (the tone).
pub fn tone_to_y(tone: f64) -> f64 {
    if tone > 8.0 {
        ((tone + 16.0) / 116.0).powi(3)
    } else {
        tone / 903.2963
    }
}

/// `#rrggbb` of a linear colour, clamped into sRGB.
pub fn hex(rgb: Rgb) -> String {
    let byte = |c: f64| (from_linear(c.clamp(0.0, 1.0)).clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(rgb[0]), byte(rgb[1]), byte(rgb[2]))
}

/// `#rrggbb` or `rrggbb` (any case, surrounding space allowed) as a linear colour.
pub fn parse_hex(value: &str) -> Option<Rgb> {
    let digits = value.trim();
    let digits = digits.strip_prefix('#').unwrap_or(digits);
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let n = u32::from_str_radix(digits, 16).ok()?;
    let channel = |shift: u32| to_linear(f64::from((n >> shift) & 255) / 255.0);
    Some([channel(16), channel(8), channel(0)])
}

/// Hue (degrees, 0..360) and chroma of a colour in OKLCH.
pub fn oklch(rgb: Rgb) -> (f64, f64) {
    let [r, g, b] = rgb;
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    let a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    let bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    ((bb.atan2(a) * 180.0 / std::f64::consts::PI + 360.0) % 360.0, a.hypot(bb))
}

/// WCAG contrast ratio of two `#rrggbb` colours; `None` when one of them is not a colour.
pub fn contrast(a: &str, b: &str) -> Option<f64> {
    let (ya, yb) = (luminance(parse_hex(a)?), luminance(parse_hex(b)?));
    Some((ya.max(yb) + 0.05) / (ya.min(yb) + 0.05))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        for value in ["#000000", "#ffffff", "#1f8a70", "#2f6bd8", "#c8498a"] {
            assert_eq!(hex(parse_hex(value).unwrap()), value);
        }
        assert_eq!(hex(parse_hex("  1F8A70 ").unwrap()), "#1f8a70");
    }

    #[test]
    fn bad_input_is_no_colour() {
        for value in ["", "#12345", "#1234567", "#12345g", "red", "##123456"] {
            assert_eq!(parse_hex(value), None, "{value}");
        }
    }

    #[test]
    fn contrast_of_black_and_white_is_21() {
        assert!((contrast("#000000", "#ffffff").unwrap() - 21.0).abs() < 1e-9);
        assert_eq!(contrast("#000000", "nope"), None);
    }

    #[test]
    fn grey_has_no_chroma() {
        let (_, c) = oklch(parse_hex("#808080").unwrap());
        assert!(c < 1e-6);
    }
}
