//! Per query token: which words of the vocabulary it matches and how well. A label is then scored by looking up its words here.
use super::{rank::*, tokens::Token};
use crate::vocab::Vocab;

/// How a token matches one word: points, and where in the word (characters).
#[derive(Clone, Copy, Default)]
pub(crate) struct Wm {
    pub score: u16,
    pub start: u16,
    pub len: u16,
}

pub(crate) struct Table {
    /// Indexed by word id; score 0 = no match.
    pub wm: Vec<Wm>,
    /// The matching words.
    pub words: Vec<u32>,
    pub fuzzy: bool,
}

impl Table {
    pub fn new(words: usize) -> Table {
        Table { wm: vec![Wm::default(); words], words: Vec::new(), fuzzy: false }
    }

    fn raise(&mut self, word: u32, score: u16, start: usize, len: usize) {
        let cell = &mut self.wm[word as usize];
        if cell.score == 0 {
            self.words.push(word);
        }
        if cell.score < score {
            *cell = Wm { score, start: start.min(u16::MAX as usize) as u16, len: len.min(u16::MAX as usize) as u16 };
        }
    }

    /// How many (label, word) pairs the token reaches: what the cheapest token to start from is chosen by.
    pub fn reach(&self, vocab: &Vocab) -> usize {
        self.words.iter().map(|&w| vocab.labels(w).len()).sum()
    }
}

/// Words that equal the token, start with it, or contain it (for tokens of three letters or more, and not for numbers).
pub(crate) fn strict(vocab: &Vocab, token: &Token) -> Table {
    let mut table = Table::new(vocab.len());
    for form in &token.forms {
        let typed = form.text.chars().count();
        let penalty = if form.alias { ALIAS_PENALTY } else { 0 };
        for position in vocab.prefix_range(&form.text) {
            let word = vocab.sorted_word(position);
            let length = vocab.chars(word);
            let score = if length == typed { EXACT } else { (PREFIX_BASE + PREFIX_SPAN * typed as u32 / length as u32) as u16 };
            table.raise(word, score - penalty, 0, typed);
        }
        if typed >= 3 && token.number.is_none() {
            vocab.each_containing(&form.text, |word, at| {
                if at > 0 {
                    let before = vocab.text(word)[..at].chars().count();
                    let score = if before + typed == vocab.chars(word) { SUFFIX } else { INFIX };
                    table.raise(word, score - penalty, before, typed);
                }
            });
        }
    }
    table
}

/// Typo tolerance applies to words of four letters or more (one edit; two from eight letters), plain ASCII, and not to numbers.
pub(crate) fn tolerance(token: &Token) -> Option<u8> {
    let form = token.forms.first()?;
    if token.number.is_some() || !form.text.is_ascii() {
        return None;
    }
    match form.text.len() {
        0..=3 => None,
        4..=7 => Some(1),
        _ => Some(2),
    }
}

/// Add the words that are a few typos away; words the token already matches keep their better score.
pub(crate) fn add_fuzzy(vocab: &Vocab, token: &Token, table: &mut Table) {
    let Some(max) = tolerance(token) else {
        return;
    };
    table.fuzzy = true;
    let Some(form) = token.forms.first() else {
        return;
    };
    vocab.each_near(form.text.as_bytes(), max, |word, edits, length| {
        if edits == 0 {
            return;
        }
        let base = if edits == 1 { FUZZY_ONE } else { FUZZY_TWO };
        let whole = if length == vocab.chars(word) { FUZZY_WHOLE } else { 0 };
        table.raise(word, base + whole, 0, length);
    });
}
