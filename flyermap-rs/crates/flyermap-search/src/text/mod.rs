//! Text handling shared by the index and the query: folding, words, abbreviations, house numbers.
mod fold;
mod number;
mod words;

pub(crate) use fold::{fold_into, Folded};
pub(crate) use number::{HouseNo, NumberQuery, UNPARSED};
pub(crate) use words::{expand, run_text, runs, words};

/// The text as the search compares it: folded (lower case, no accents, "ß" as "ss", "ae" as "a" …), abbreviations written out,
/// words separated by one space. Folding twice changes nothing.
pub fn normalize(text: &str) -> String {
    let mut folded = Vec::new();
    fold_into(text, &mut folded);
    let parts: Vec<String> = runs(&folded).into_iter().map(|run| run_text(&folded, run)).map(|w| expand(&w).unwrap_or(w)).collect();
    parts.join(" ")
}
