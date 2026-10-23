//! Words of a folded text, with the abbreviations of addresses written out ("Str." is "Straße", "Dr." is "Doktor").
use super::fold::{Folded, SEP};

/// Longer texts (a long note) are searched by their first words only.
pub(crate) const MAX_WORDS: usize = 64;

/// Abbreviations that stand for a whole word. The index writes them out, the query tries both spellings.
const WHOLE: [(&str, &str); 7] =
    [("str", "strasse"), ("pl", "platz"), ("dr", "doktor"), ("prof", "professor"), ("st", "sankt"), ("hbf", "hauptbahnhof"), ("bhf", "bahnhof")];

/// The word with its abbreviation written out, if it is one: "str" → "strasse", "hauptstr" → "hauptstrasse", "marktpl" → "marktplatz".
pub(crate) fn expand(word: &str) -> Option<String> {
    if let Some((_, full)) = WHOLE.iter().find(|(short, _)| *short == word) {
        return Some((*full).to_string());
    }
    for (short, full) in &WHOLE[..2] {
        if let Some(stem) = word.strip_suffix(short) {
            if stem.chars().count() >= 3 {
                return Some(format!("{stem}{full}"));
            }
        }
    }
    None
}

/// A word of a title as it is indexed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Word {
    pub text: String,
    /// The folded characters `first..end` it stands for (to find the original bytes again).
    pub first: usize,
    pub end: usize,
    /// An abbreviation that was written out: a match then shows the whole original word.
    pub expanded: bool,
}

/// The runs of letters and digits as `(first, end)` positions in `folded`.
pub(crate) fn runs(folded: &[Folded]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut open: Option<usize> = None;
    for (i, f) in folded.iter().enumerate() {
        match (f.ch == SEP, open) {
            (false, None) => open = Some(i),
            (true, Some(first)) => {
                out.push((first, i));
                open = None;
            }
            _ => {}
        }
    }
    if let Some(first) = open {
        out.push((first, folded.len()));
    }
    out
}

pub(crate) fn run_text(folded: &[Folded], (first, end): (usize, usize)) -> String {
    folded[first..end].iter().map(|f| f.ch).collect()
}

/// The words of a title, abbreviations written out, at most `MAX_WORDS`.
pub(crate) fn words(folded: &[Folded]) -> Vec<Word> {
    runs(folded)
        .into_iter()
        .take(MAX_WORDS)
        .map(|run| {
            let raw = run_text(folded, run);
            match expand(&raw) {
                Some(text) => Word { text, first: run.0, end: run.1, expanded: true },
                None => Word { text: raw, first: run.0, end: run.1, expanded: false },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::fold::fold_into;

    fn texts(title: &str) -> Vec<String> {
        let mut folded = Vec::new();
        fold_into(title, &mut folded);
        words(&folded).into_iter().map(|w| w.text).collect()
    }

    #[test]
    fn abbreviations_are_written_out() {
        assert_eq!(texts("Dr.-Eschenbach-Str."), ["doktor", "eschenbach", "strasse"]);
        assert_eq!(texts("Hauptstr. 3"), ["hauptstrasse", "3"]);
        assert_eq!(texts("Marktpl."), ["marktplatz"]);
        assert_eq!(texts("St. Aurel Platz"), ["sankt", "aurel", "platz"]);
    }

    #[test]
    fn short_stems_are_not_abbreviations() {
        assert_eq!(expand("apl"), None);
        assert_eq!(expand("strasse"), None);
    }
}
