//! A candidate turned into a hit: the entry, its title and subtitle, and the stretches of the title the query matched.
use super::{
    assign::assign,
    members::{Cand, NO_RUN, WHOLE_NUMBER},
    Run,
};
use crate::{
    german,
    hit::Hit,
    index::{Data, Index, Slot},
    text::{fold_into, words},
};
use std::ops::Range;

pub(crate) fn hit(index: &Index, runs: &[Run], c: &Cand) -> Hit {
    let slot = index.slot(c.slot);
    let entry = index.entry_at(c.slot);
    let title = entry.title();
    let highlights = if c.run == NO_RUN { Vec::new() } else { highlights(index, &runs[c.run as usize], slot, &title, c.digits) };
    Hit { kind: slot.data.kind(), subtitle: subtitle(index, slot), position: entry.position(), score: c.score, title, entry, highlights }
}

/// The words of the query as stretches of the title as it was written ("Mueller" for "muller", "Straße" for "strasse").
fn highlights(index: &Index, run: &Run, slot: &Slot, title: &str, digits: u8) -> Vec<Range<usize>> {
    let Some(label) = index.labels[slot.label as usize].as_ref() else {
        return Vec::new();
    };
    let a = assign(label, &run.tables, &run.order);
    let mut folded = Vec::new();
    fold_into(&label.title, &mut folded);
    let title_words = words(&folded);
    let mut spans: Vec<Range<usize>> = Vec::new();
    for t in (0..run.parse.tokens.len()).filter(|&t| a.has(t)) {
        let part = a.parts[t];
        let Some(word) = title_words.get(part.word as usize).filter(|_| (part.word as usize) < label.n_title as usize) else {
            continue;
        };
        let (from, to) = if word.expanded {
            (word.first, word.end)
        } else {
            (word.first + part.start as usize, (word.first + part.start as usize + part.len as usize).min(word.end))
        };
        if from < to {
            spans.push(folded[from].start as usize..folded[to - 1].end as usize);
        }
    }
    if digits != 0 && matches!(slot.data, Data::House { .. }) {
        let start = label.title.len() + 1;
        let number = &title[start.min(title.len())..];
        let length = if digits == WHOLE_NUMBER { number.len() } else { number.bytes().take_while(u8::is_ascii_digit).count().min(digits as usize) };
        if length > 0 {
            spans.push(start..start + length);
        }
    }
    merge(spans)
}

fn merge(mut spans: Vec<Range<usize>>) -> Vec<Range<usize>> {
    spans.sort_by_key(|s| (s.start, s.end));
    let mut out: Vec<Range<usize>> = Vec::new();
    for span in spans {
        match out.last_mut() {
            Some(last) if span.start <= last.end => last.end = last.end.max(span.end),
            _ => out.push(span),
        }
    }
    out
}

fn subtitle(index: &Index, slot: &Slot) -> String {
    let place = index.area_id(slot.area).and_then(|id| index.by_id.get(id)).map(|&s| index.label_title(index.slot(s)));
    match &slot.data {
        Data::Street { .. } => {
            let houses = index.labels[slot.label as usize].as_ref().map_or(0, |l| l.houses.len());
            let base = if houses > 0 { german::house_count(houses) } else { german::kind_subtitle(slot.data.kind()).to_string() };
            german::with_place(&base, place)
        }
        Data::House { .. } => german::with_place(german::kind_subtitle(slot.data.kind()), place),
        Data::Area { art } => german::with_place(german::kind_subtitle(slot.data.kind()), Some(german::art_name(*art))),
        Data::Note { key } => {
            let target = index.by_id.get(key.as_ref()).map(|&s| index.entry_at(s).title());
            german::with_place(german::kind_subtitle(slot.data.kind()), target.as_deref())
        }
        Data::Group | Data::Person | Data::Command { .. } => german::kind_subtitle(slot.data.kind()).to_string(),
    }
}
