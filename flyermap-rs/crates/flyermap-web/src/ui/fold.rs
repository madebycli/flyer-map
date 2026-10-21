//! Text matching for searchable lists: lower case, accents and umlauts folded, `ß` as `ss`, so "strasse" finds "Straße" and "muller" "Müller".
//! (The TypeScript lists fold with NFD; a hand-written map keeps the Unicode tables out of the WebAssembly and covers what German text needs.)

pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        match c {
            'ä' | 'á' | 'à' | 'â' | 'ã' | 'å' => out.push('a'),
            'ö' | 'ó' | 'ò' | 'ô' | 'õ' | 'ø' => out.push('o'),
            'ü' | 'ú' | 'ù' | 'û' => out.push('u'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            'ß' => out.push_str("ss"),
            // combining marks of text that arrives decomposed
            '\u{300}'..='\u{36f}' => {}
            c => out.push(c),
        }
    }
    out
}

/// Every word of the query (folded) occurs in the folded haystack. A blank query matches everything.
pub fn matches_all_words(query: &str, haystack: &str) -> bool {
    let hay = fold(haystack);
    fold(query)
        .split_whitespace()
        .all(|word| hay.contains(word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn umlauts_and_sharp_s_fold() {
        assert_eq!(fold("Straße Über Café"), "strasse uber cafe");
        assert_eq!(fold("Cafe\u{301}"), "cafe");
    }

    #[test]
    fn all_words_must_match_in_any_order() {
        assert!(matches_all_words("haupt 12", "Hauptstraße 12"));
        assert!(matches_all_words("12 HAUPT", "Hauptstraße 12"));
        assert!(!matches_all_words("haupt 13", "Hauptstraße 12"));
        assert!(matches_all_words("  ", "anything"));
    }
}
