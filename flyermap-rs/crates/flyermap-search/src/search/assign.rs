//! Which token matches which word of a label, and what that is worth. The same code scores a label while searching and finds the
//! matched stretches again for the highlights, so what is shown is exactly what was scored.
use super::{rank::*, tables::Table, tokens::MAX_TOKENS};
use crate::{index::Label, vocab::Vocab};

#[derive(Clone, Copy, Default)]
pub(crate) struct Part {
    /// Index into the label's word list.
    pub word: u16,
    pub start: u16,
    pub len: u16,
    pub score: u16,
}

#[derive(Default)]
pub(crate) struct Assigned {
    pub parts: [Part; MAX_TOKENS],
    /// Bit `t` is set when token `t` found a word.
    pub matched: u16,
}

impl Assigned {
    pub fn has(&self, token: usize) -> bool {
        self.matched & (1 << token) != 0
    }
}

fn overlaps(a: &Part, start: u16, len: u16) -> bool {
    a.start < start + len && start < a.start + a.len
}

/// Give each token (in `order`) the best word of the label that is still free; a word may serve two tokens when they match different
/// stretches of it ("haupt" and "str" in "hauptstrasse"). Tokens that find nothing stay unmatched.
pub(crate) fn assign(label: &Label, tables: &[Table], order: &[usize]) -> Assigned {
    let mut out = Assigned::default();
    for &token in order {
        let Some(table) = tables.get(token).filter(|t| !t.words.is_empty()) else {
            continue;
        };
        let mut best: Option<(u16, usize, u16, u16)> = None;
        for (j, &word) in label.words.iter().enumerate() {
            let wm = table.wm[word as usize];
            if wm.score == 0 {
                continue;
            }
            let taken = (0..MAX_TOKENS).any(|u| out.has(u) && out.parts[u].word as usize == j && overlaps(&out.parts[u], wm.start, wm.len));
            if taken {
                continue;
            }
            let score = if j >= label.n_title as usize { wm.score / EXTRA_DEN * EXTRA_NUM } else { wm.score };
            if best.is_none_or(|(s, ..)| score > s) {
                best = Some((score, j, wm.start, wm.len));
            }
        }
        if let Some((score, j, start, len)) = best {
            out.parts[token] = Part { word: j as u16, start, len, score };
            out.matched |= 1 << token;
        }
    }
    out
}

/// Points for a label from its assignment: the mean of the tokens' scores, plus bonuses for starting like the title, for typing the whole
/// title, for typing words in order, and for how much of the title was matched.
pub(crate) fn text_score(label: &Label, vocab: &Vocab, a: &Assigned, tokens: usize) -> u32 {
    let n_title = label.n_title as usize;
    let (mut sum, mut count, mut covered, mut starts, mut exact_words) = (0u32, 0u32, 0u32, false, 0usize);
    let (mut in_order, mut last_word) = (true, 0u16);
    for t in 0..tokens {
        if !a.has(t) {
            continue;
        }
        let part = a.parts[t];
        sum += part.score as u32;
        count += 1;
        if (part.word as usize) < n_title {
            covered += part.len as u32;
            starts |= part.word == 0 && part.start == 0;
            if part.score >= EXACT - ALIAS_PENALTY {
                exact_words += 1;
            }
            in_order &= part.word >= last_word;
            last_word = part.word;
        }
    }
    if count == 0 {
        return 0;
    }
    let title_chars: u32 = label.words[..n_title].iter().map(|&w| vocab.chars(w) as u32).sum::<u32>().max(1);
    let mut score = sum / count + COVERAGE * covered.min(title_chars) / title_chars;
    if starts {
        score += STARTS_WITH;
    }
    if in_order && count > 1 {
        score += IN_ORDER;
    }
    if exact_words >= n_title && n_title > 0 {
        score += WHOLE_TITLE;
    }
    score
}
