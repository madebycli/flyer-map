//! From a label that matched the words of the query to the entries under it: the street, the note, the command, and the houses whose
//! number answers the number that was typed.
use super::{assign::Assigned, context::Ctx, rank::*, Run};
use crate::{
    entry::Kind,
    index::{Data, Index, Label},
};

/// A hit before it is built: which entry, how it scores, and which run's tables explain it.
#[derive(Clone, Copy)]
pub(crate) struct Cand {
    pub slot: u32,
    pub score: u32,
    pub run: u8,
    /// How much of a house number to highlight: 0 nothing, `WHOLE_NUMBER` all of it, else this many leading digits.
    pub digits: u8,
}

pub(crate) const WHOLE_NUMBER: u8 = 255;
pub(crate) const NO_RUN: u8 = 255;

fn points(score: f32) -> u32 {
    score.round().max(0.0) as u32
}

/// `text` is the label's score for the words of the query; number tokens that matched no word of the label are the house number.
pub(crate) fn expand(index: &Index, ctx: &Ctx, run: &Run, run_no: u8, label: &Label, a: &Assigned, text: u32, out: &mut Vec<Cand>) {
    let tokens = &run.parse.tokens;
    let unmatched: Vec<usize> = (0..tokens.len()).filter(|&t| tokens[t].number.is_some() && !a.has(t)).collect();
    for &s in &label.members {
        let slot = index.slot(s);
        if !ctx.admits(slot) {
            continue;
        }
        let kind = slot.data.kind();
        let mut score = text as f32 * kind_weight(kind) * ctx.factor(s, slot);
        if !unmatched.is_empty() {
            // a number was typed that this entry has no place for: only a street can still be right (the house is not in the data)
            if kind != Kind::Street {
                continue;
            }
            score *= UNMATCHED_NUMBER.powi(unmatched.len() as i32);
        }
        out.push(Cand { slot: s, score: points(score), run: run_no, digits: 0 });
    }
    let Some(number) = unmatched.first().and_then(|&t| tokens[t].number.as_ref()) else {
        return;
    };
    if !ctx.kinds.contains(Kind::House) {
        return;
    }
    for &(_, s) in &label.houses {
        let slot = index.slot(s);
        let Data::House { no, .. } = &slot.data else {
            continue;
        };
        let n = number.score(no);
        if n == 0 {
            continue;
        }
        // the street counts most; of a number that is only nearly right (12 for 12a) a little is lost
        let score = text as f32 * (0.5 + 0.5 * n as f32 / 1000.0) * ctx.factor(s, slot);
        let digits = if n == 1000 { WHOLE_NUMBER } else { number.typed_digits() };
        out.push(Cand { slot: s, score: points(score), run: run_no, digits });
    }
}
