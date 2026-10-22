//! The query text as tokens: words (with the other spellings they may stand for) and house numbers ("12", "12a", "12-14").
use crate::{
    german,
    text::{expand, fold_into, run_text, runs, Folded, NumberQuery},
};

/// More tokens than this are ignored.
pub(crate) const MAX_TOKENS: usize = 8;

/// One way a token may be written in the index.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Form {
    pub text: String,
    /// Written out from an abbreviation ("str" → "strasse"): matches a little worse than what was typed.
    pub alias: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Token {
    /// What a word of a title may look like to match this token. Empty for a range ("12-14"), which only matches house numbers.
    pub forms: Vec<Form>,
    /// The token read as a house number, if it is one.
    pub number: Option<NumberQuery>,
}

impl Token {
    fn word(text: &str) -> Token {
        let mut forms = vec![Form { text: text.to_string(), alias: false }];
        if let Some(full) = expand(text) {
            forms.push(Form { text: full, alias: true });
        }
        Token { forms, number: None }
    }

    fn number(query: NumberQuery, text: &str) -> Token {
        Token { forms: vec![Form { text: text.to_string(), alias: false }], number: Some(query) }
    }

    /// The longest form, in characters (what sets how much typo tolerance there is, and the order tokens are placed in).
    pub fn len(&self) -> usize {
        self.forms.iter().map(|f| f.text.chars().count()).max().unwrap_or(0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Parse {
    pub tokens: Vec<Token>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Sep {
    /// Parts of one typed word ("hauptstr12").
    Glued,
    Space,
    Dash,
    Other,
}

fn classify(between: &str) -> Sep {
    match between.trim() {
        "" => Sep::Space,
        "-" | "/" | "–" | "—" => Sep::Dash,
        _ => Sep::Other,
    }
}

/// "hauptstr12a" is a street and a number; "12haupt" too; "a8" and "12a" stay whole.
fn split_mixed(word: &str) -> Vec<&str> {
    let b = word.as_bytes();
    if !word.is_ascii() {
        return vec![word];
    }
    match b.iter().position(u8::is_ascii_digit) {
        Some(0) => {
            let digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
            if b.len() - digits >= 3 && b[digits..].iter().all(u8::is_ascii_alphabetic) {
                return vec![&word[..digits], &word[digits..]];
            }
            vec![word]
        }
        Some(at) if at >= 3 && NumberQuery::from_token(&word[at..]).is_some() && b[..at].iter().all(u8::is_ascii_alphabetic) => vec![&word[..at], &word[at..]],
        _ => vec![word],
    }
}

/// The pieces of the text with what stood in front of each.
fn pieces(text: &str, folded: &[Folded]) -> Vec<(Sep, String)> {
    let mut out: Vec<(Sep, String)> = Vec::new();
    let mut previous_end = 0usize;
    for run in runs(folded) {
        let start = folded[run.0].start as usize;
        let sep = if out.is_empty() { Sep::Space } else { classify(&text[previous_end..start]) };
        previous_end = folded[run.1 - 1].end as usize;
        let word = run_text(folded, run);
        for (i, part) in split_mixed(&word).into_iter().enumerate() {
            out.push((if i == 0 { sep } else { Sep::Glued }, part.to_string()));
        }
    }
    out
}

/// The reading(s) of the query: usually one; two when a lone letter follows a number ("12 a" is house 12a, or 12 and a word that starts with a).
pub(crate) fn parse(text: &str) -> Vec<Parse> {
    let mut folded = Vec::new();
    fold_into(text, &mut folded);
    let mut pieces = pieces(text, &folded);
    if pieces.len() > 1 {
        pieces.retain(|(_, w)| !german::FILLER.contains(&w.as_str()));
    }
    let mut tokens: Vec<Token> = Vec::new();
    let mut letter_after_number: Option<usize> = None;
    for (sep, word) in pieces {
        match NumberQuery::from_token(&word) {
            Some(query) => {
                let joined = match (tokens.last().and_then(|t| t.number.as_ref()), sep) {
                    (Some(lo), Sep::Dash) if !lo.range => NumberQuery::range_of(lo, &query),
                    _ => None,
                };
                match joined {
                    Some(range) => {
                        let last = tokens.len() - 1;
                        tokens[last] = Token { forms: Vec::new(), number: Some(range) };
                    }
                    None => tokens.push(Token::number(query, &word)),
                }
            }
            None => {
                let after_plain_number = tokens.last().and_then(|t| t.number.as_ref()).is_some_and(|n| !n.range && !n.has_addition());
                if sep == Sep::Space && after_plain_number && word.len() == 1 && word.is_ascii() && letter_after_number.is_none() {
                    letter_after_number = Some(tokens.len());
                }
                tokens.push(Token::word(&word));
            }
        }
    }
    tokens.truncate(MAX_TOKENS);
    if tokens.is_empty() {
        return Vec::new();
    }
    let mut parses = vec![Parse { tokens: tokens.clone() }];
    if let Some(at) = letter_after_number.filter(|&at| at < tokens.len()) {
        let letter = tokens[at].forms[0].text.as_bytes()[0] - b'a' + 1;
        let mut joined = tokens;
        joined.remove(at);
        if let Some(number) = joined[at - 1].number.take() {
            joined[at - 1].number = Some(number.with_addition(letter));
            parses.push(Parse { tokens: joined });
        }
    }
    parses
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(text: &str) -> Vec<Vec<String>> {
        parse(text)
            .iter()
            .map(|p| {
                p.tokens
                    .iter()
                    .map(|t| match (&t.number, t.forms.first()) {
                        (Some(n), _) if n.range => "range".to_string(),
                        (Some(n), _) => format!("#{}{}", n.lo.0, if n.lo.1 == 0 { String::new() } else { ((b'a' + n.lo.1 - 1) as char).to_string() }),
                        (_, Some(f)) => f.text.clone(),
                        _ => "?".to_string(),
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn words_and_numbers_are_told_apart_in_any_order() {
        assert_eq!(shape("Hauptstr. 12a"), [["hauptstr", "#12a"]]);
        assert_eq!(shape("12a hauptstr"), [["#12a", "hauptstr"]]);
        assert_eq!(shape("Hauptstr12a"), [["hauptstr", "#12a"]]);
        assert_eq!(shape("a8"), [["a8"]]);
        assert_eq!(shape("Hauptstraße Nr. 12"), [["hauptstrasse", "#12"]]);
    }

    #[test]
    fn a_range_is_one_token() {
        assert_eq!(shape("hauptstr 12-14"), [["hauptstr", "range"]]);
        assert_eq!(shape("hauptstr 12 - 14"), [["hauptstr", "range"]]);
        assert_eq!(shape("hauptstr 12 14"), [["hauptstr", "#12", "#14"]]);
    }

    #[test]
    fn a_lone_letter_after_a_number_has_two_readings() {
        assert_eq!(shape("hauptstr 12 a"), [vec!["hauptstr", "#12", "a"], vec!["hauptstr", "#12a"]]);
        assert_eq!(shape("hauptstr 12 al").len(), 1);
    }

    #[test]
    fn abbreviations_get_a_second_form() {
        let p = &parse("Str")[0];
        assert_eq!(p.tokens[0].forms, [Form { text: "str".into(), alias: false }, Form { text: "strasse".into(), alias: true }]);
    }

    #[test]
    fn nothing_to_search_is_no_parse() {
        assert!(parse("  .. - ").is_empty());
        assert!(parse("").is_empty());
    }
}
