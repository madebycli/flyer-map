//! The candidates become the answer: ordered, cut to the limit with every kind getting its room, built into hits.
use super::{context::Ctx, explain, members::Cand, rank::*, Run};
use crate::{
    entry::Kind,
    hit::{Hit, Results},
    index::{Data, Index},
};
use rustc_hash::FxHashSet;
use std::cmp::Ordering;

/// Digit runs compare by value, everything else by character: "Hauptstraße 2" before "Hauptstraße 10".
fn natural(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let (dx, dy) = (take_digits(&mut x), take_digits(&mut y));
                let (tx, ty) = (dx.trim_start_matches('0'), dy.trim_start_matches('0'));
                let order = tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty)).then_with(|| dx.len().cmp(&dy.len()));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(p), Some(q)) => {
                if p != q {
                    return p.cmp(&q);
                }
                x.next();
                y.next();
            }
        }
    }
}

fn take_digits(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut out = String::new();
    while let Some(&c) = chars.peek().filter(|c| c.is_ascii_digit()) {
        out.push(c);
        chars.next();
    }
    out
}

/// Best first. Equal scores are told apart by what the entries are (title, house number, id), never by where they happen to be stored,
/// so an index that was updated answers exactly like one built from scratch.
fn order(index: &Index, a: &Cand, b: &Cand) -> Ordering {
    b.score.cmp(&a.score).then_with(|| {
        let (x, y) = (index.slot(a.slot), index.slot(b.slot));
        let number = |d: &Data| match d {
            Data::House { no, .. } => (no.lo, no.hi),
            _ => ((0, 0), (0, 0)),
        };
        natural(index.label_title(x), index.label_title(y)).then_with(|| number(&x.data).cmp(&number(&y.data))).then_with(|| x.id.cmp(&y.id))
    })
}

/// The hits to show: no kind takes more than its share while other kinds have candidates, the rest is filled up in rank order.
fn balance(index: &Index, cands: &[Cand], limit: usize) -> Vec<usize> {
    let cap = (limit * KIND_SHARE_NUM / KIND_SHARE_DEN).max(KIND_MIN_ROOM);
    let mut taken = [0usize; Kind::ALL.len()];
    let mut chosen = vec![false; cands.len()];
    let mut total = 0;
    for (i, c) in cands.iter().enumerate() {
        let kind = index.slot(c.slot).data.kind() as usize;
        if total < limit && taken[kind] < cap {
            chosen[i] = true;
            taken[kind] += 1;
            total += 1;
        }
    }
    for flag in chosen.iter_mut() {
        if total < limit && !*flag {
            *flag = true;
            total += 1;
        }
    }
    (0..cands.len()).filter(|&i| chosen[i]).collect()
}

pub(crate) fn finish(index: &Index, ctx: &Ctx, runs: &[Run], mut cands: Vec<Cand>) -> Results {
    let keep = ctx.limit * KEPT_PER_LIMIT;
    if cands.len() > keep {
        cands.select_nth_unstable_by(keep, |a, b| order(index, a, b));
        cands.truncate(keep);
    }
    cands.sort_by(|a, b| order(index, a, b));
    let mut seen = FxHashSet::default();
    cands.retain(|c| seen.insert(c.slot));
    let hits: Vec<Hit> = balance(index, &cands, ctx.limit).into_iter().map(|i| explain::hit(index, runs, &cands[i])).collect();
    Results::from_ranked(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_inside_text_compare_by_value() {
        assert_eq!(natural("hauptstrasse 2", "hauptstrasse 10"), Ordering::Less);
        assert_eq!(natural("a007", "a7"), Ordering::Greater);
        assert_eq!(natural("abc", "abc"), Ordering::Equal);
        assert_eq!(natural("ab", "abc"), Ordering::Less);
    }
}
