//! JavaScript number formatting where the bytes matter (the Overpass query is compared word for word with the TypeScript one).

/// `Number.prototype.toFixed(digits)` for |x| < 1e21: the nearest decimal, exact ties rounded away from zero (Rust rounds them to even), and a
/// negative number keeps its sign even when it rounds to zero (`(-0.0000004).toFixed(6)` is `"-0.000000"`).
pub fn to_fixed(x: f64, digits: usize) -> String {
    let negative = x < 0.0;
    let a = x.abs();
    // The exact decimal expansion of the double (a double has at most 1074 fractional digits).
    let exact = format!("{a:.1100}");
    let (int_part, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let rest = &frac[digits..];
    let tie = rest.as_bytes().first() == Some(&b'5') && rest[1..].bytes().all(|b| b == b'0');
    let rounded = if tie {
        // round up in magnitude: add one unit in the last place to the truncated digits
        let mut digits_vec: Vec<u8> = format!("{int_part}{}", &frac[..digits]).into_bytes();
        let mut i = digits_vec.len();
        loop {
            if i == 0 {
                digits_vec.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits_vec[i] == b'9' {
                digits_vec[i] = b'0';
            } else {
                digits_vec[i] += 1;
                break;
            }
        }
        let text = String::from_utf8(digits_vec).unwrap_or_default();
        let split = text.len() - digits;
        if digits == 0 {
            text
        } else {
            format!("{}.{}", &text[..split], &text[split..])
        }
    } else {
        format!("{a:.digits$}")
    };
    if negative {
        format!("-{rounded}")
    } else {
        rounded
    }
}

#[cfg(test)]
mod tests {
    use super::to_fixed;

    #[test]
    fn like_javascript() {
        assert_eq!(to_fixed(0.0078125, 6), "0.007813");
        assert_eq!(to_fixed(-0.0078125, 6), "-0.007813");
        assert_eq!(to_fixed(1.5, 0), "2");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(9.5, 0), "10");
        assert_eq!(to_fixed(-0.0000004, 6), "-0.000000");
        assert_eq!(to_fixed(0.0, 6), "0.000000");
        assert_eq!(to_fixed(179.9999995, 6), "180.000000");
    }
}
