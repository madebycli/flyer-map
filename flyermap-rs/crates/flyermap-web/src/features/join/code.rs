//! An invitation code as people type and read it: ten characters of Crockford base32 (no I, L, O, U), in capitals. Typed codes come with spaces and
//! dashes, in lower case, with an O for the zero; all of that is forgiven. (`flyermap_identity::invite` will own the format once it exists.)

/// The canonical form: upper case, separators gone, `I`/`L` read as `1`, `O` as `0`. Characters that cannot be part of a code are dropped.
pub fn normalize_code(typed: &str) -> String {
    typed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'I' | 'L' => '1',
            'O' => '0',
            other => other,
        })
        .filter(|c| *c != 'U')
        .collect()
}

pub const CODE_LEN: usize = 10;

/// The code as shown: `7K2QX-9M4TB`.
pub fn display_code(code: &str) -> String {
    let c = normalize_code(code);
    if c.len() > CODE_LEN / 2 {
        format!("{}-{}", &c[..CODE_LEN / 2], &c[CODE_LEN / 2..])
    } else {
        c
    }
}

/// The code out of what was scanned or pasted: a bare code, or a link ending in `/beitreten/<code>`.
pub fn code_from_text(text: &str) -> Option<String> {
    let tail = text.trim().rsplit_once("/beitreten/").map_or(text.trim(), |(_, t)| t);
    let tail = tail.split(['?', '#']).next().unwrap_or("");
    let code = normalize_code(tail);
    (code.len() == CODE_LEN).then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_habits_are_forgiven() {
        assert_eq!(normalize_code("7k2qx 9m4tb"), "7K2QX9M4TB");
        assert_eq!(normalize_code("7K2QX-9M4TB"), "7K2QX9M4TB");
        assert_eq!(normalize_code("oIl0"), "0110", "O is zero, I and L are one");
        assert_eq!(display_code("7k2qx9m4tb"), "7K2QX-9M4TB");
        assert_eq!(display_code("7K2"), "7K2");
    }

    #[test]
    fn a_link_or_a_scan_gives_the_code() {
        assert_eq!(code_from_text("https://example.test/beitreten/7K2QX-9M4TB?x=1").as_deref(), Some("7K2QX9M4TB"));
        assert_eq!(code_from_text(" 7k2qx9m4tb ").as_deref(), Some("7K2QX9M4TB"));
        assert_eq!(code_from_text("zu kurz"), None);
        assert_eq!(code_from_text("https://example.test/anders"), None);
    }
}
