//! The search. A query becomes tokens; each token is matched against the vocabulary once (a table of words and points); the labels
//! that contain a matching word for every word token are scored; the entries under them become candidates; the best are built into hits.
//!
//! 1. exact, prefix and inside-the-word matches; tokens that match nothing get typo tolerance on top;
//! 2. if that left no hit at all, typo tolerance for the other tokens too;
//! 3. a lone house number is read on the street the person is on.
mod assign;
mod context;
mod digits;
mod empty;
mod explain;
mod finish;
mod members;
mod rank;
mod tables;
mod tokens;

use crate::{hit::Results, index::Index, query::Query};
use assign::{assign, text_score};
use context::Ctx;
use members::Cand;
use tables::{add_fuzzy, strict, tolerance, Table};
use tokens::Parse;

/// One reading of the query with what is needed to score and explain its hits.
pub(crate) struct Run {
    pub parse: Parse,
    pub tables: Vec<Table>,
    /// The order tokens are given words in: longest first, numbers last.
    pub order: Vec<usize>,
}

impl Run {
    fn new(index: &Index, parse: Parse) -> Run {
        let mut tables = Vec::with_capacity(parse.tokens.len());
        for token in &parse.tokens {
            if token.forms.is_empty() {
                tables.push(Table::new(0));
                continue;
            }
            let mut table = strict(&index.vocab, token);
            if table.words.is_empty() {
                add_fuzzy(&index.vocab, token, &mut table);
            }
            tables.push(table);
        }
        let mut order: Vec<usize> = (0..parse.tokens.len()).filter(|&t| !parse.tokens[t].forms.is_empty()).collect();
        order.sort_by_key(|&t| (parse.tokens[t].number.is_some(), std::cmp::Reverse(parse.tokens[t].len()), t));
        Run { parse, tables, order }
    }

    /// Typo tolerance for the tokens that did not get it yet. False when there was none to add.
    fn loosen(&mut self, index: &Index) -> bool {
        let mut changed = false;
        for (token, table) in self.parse.tokens.iter().zip(self.tables.iter_mut()) {
            if !table.fuzzy && tolerance(token).is_some() {
                add_fuzzy(&index.vocab, token, table);
                changed = true;
            }
        }
        changed
    }
}

/// The candidates of one reading.
fn gather(index: &Index, ctx: &Ctx, run: &Run, run_no: u8, out: &mut Vec<Cand>) {
    let tokens = &run.parse.tokens;
    if tokens.iter().all(|t| t.number.is_some()) {
        digits::houses_by_number(index, ctx, run, run_no, out);
    }
    // word tokens must all be found in the label; when only numbers were typed they are looked for as words too ("17" in "Straße des 17. Juni")
    let words: Vec<usize> = (0..tokens.len()).filter(|&t| !tokens[t].forms.is_empty() && tokens[t].number.is_none()).collect();
    let required: Vec<usize> = if words.is_empty() { (0..tokens.len()).filter(|&t| !tokens[t].forms.is_empty()).collect() } else { words };
    if required.is_empty() || required.iter().any(|&t| run.tables[t].words.is_empty()) {
        return;
    }
    let Some(pivot) = required.iter().copied().min_by_key(|&t| run.tables[t].reach(&index.vocab)) else {
        return;
    };
    let mut seen = vec![false; index.labels.len()];
    for &word in &run.tables[pivot].words {
        for &at in index.vocab.labels(word) {
            if std::mem::replace(&mut seen[at as usize], true) {
                continue;
            }
            let Some(label) = index.labels[at as usize].as_ref() else {
                continue;
            };
            let a = assign(label, &run.tables, &run.order);
            if required.iter().all(|&t| a.has(t)) {
                let text = text_score(label, &index.vocab, &a, tokens.len());
                members::expand(index, ctx, run, run_no, label, &a, text, out);
            }
        }
    }
}

impl Index {
    /// The best hits for the query in the situation it comes with, ranked over all kinds and grouped by kind.
    pub fn search(&self, query: &Query) -> Results {
        let ctx = Ctx::new(self, &query.context);
        if ctx.limit == 0 {
            return Results::default();
        }
        let parses = tokens::parse(&query.text);
        if parses.is_empty() {
            return finish::finish(self, &ctx, &[], empty::candidates(self, &ctx));
        }
        let mut runs: Vec<Run> = Vec::new();
        let mut cands: Vec<Cand> = Vec::new();
        for (no, parse) in parses.into_iter().enumerate() {
            let mut run = Run::new(self, parse);
            let before = cands.len();
            gather(self, &ctx, &run, no as u8, &mut cands);
            if cands.len() == before && run.loosen(self) {
                gather(self, &ctx, &run, no as u8, &mut cands);
            }
            runs.push(run);
        }
        finish::finish(self, &ctx, &runs, cands)
    }
}
