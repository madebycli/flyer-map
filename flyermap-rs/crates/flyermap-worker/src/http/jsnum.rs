//! JavaScript's `Number(text)` for query parameters, so that odd inputs (`abc`, ` 12 `, `1e2`, `0x10`) end up exactly where the TypeScript Worker put them.

/// `Number(text)`; `None` stands for `NaN`.
pub fn js_number(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return Some(0.0);
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'-' => (-1.0, &t[1..]),
        b'+' => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).ok().map(|v| v as f64);
        }
    }
    if body == "Infinity" {
        return Some(sign * f64::INFINITY);
    }
    if !body.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) || body.is_empty() {
        return None;
    }
    body.parse::<f64>().ok().map(|v| sign * v)
}

/// `Math.trunc(Number(text)) || fallback` (NaN and 0 both fall back), as an integer clamp-ready value.
pub fn trunc_or(text: Option<&str>, default_text: &str, fallback: f64) -> f64 {
    let n = js_number(text.unwrap_or(default_text)).map(f64::trunc).unwrap_or(f64::NAN);
    if n.is_nan() || n == 0.0 {
        fallback
    } else {
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_javascript_number() {
        assert_eq!(js_number(""), Some(0.0));
        assert_eq!(js_number(" 12 "), Some(12.0));
        assert_eq!(js_number("1e2"), Some(100.0));
        assert_eq!(js_number("0x10"), Some(16.0));
        assert_eq!(js_number("-4"), Some(-4.0));
        assert_eq!(js_number("abc"), None);
        assert_eq!(js_number("12px"), None);
        assert_eq!(trunc_or(Some("abc"), "0", 0.0), 0.0);
        assert_eq!(trunc_or(Some("-4.7"), "1000", 1000.0), -4.0);
        assert_eq!(trunc_or(None, "1000", 1000.0), 1000.0);
    }
}
