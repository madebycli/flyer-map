//! One module per kind of command. Each one: look at the shape, ask the rights (`rights::Ctx`), look at the state, then `Out::emit` the changes. A command
//! that returns an error has written nothing (its transaction is undone).
mod cleanup;
mod collect;
mod gebiet;
mod gruppe;
mod lauf;
mod marks;
mod notes;

use crate::{fail::R, out::Out, rights::Ctx, sql::Sql};
use flyermap_protocol::{Body, Counts, Refused};

/// What a command did, for the answer.
#[derive(Debug, Default)]
pub(crate) struct Done {
    pub applied: u32,
    pub stale: u32,
    pub refused: Vec<Refused>,
    pub orphans: Option<Counts>,
}

impl Done {
    pub fn applied(n: u32) -> Done {
        Done { applied: n, ..Done::default() }
    }

    /// Nothing to do: the command said what already is.
    pub fn unchanged() -> Done {
        Done { stale: 1, ..Done::default() }
    }
}

pub(crate) fn dispatch<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, body: &Body) -> R<Done> {
    match body {
        Body::Marks { gebiet, marks } => marks::run(sql, cx, out, gebiet, marks),
        Body::Note { note } => notes::run(sql, cx, out, note),
        Body::Gruppe { gruppe } => gruppe::upsert(sql, cx, out, gruppe),
        Body::GruppeRemove { id, base_rev } => gruppe::remove(sql, cx, out, id, *base_rev),
        Body::Gebiet { gebiet } => gebiet::upsert(sql, cx, out, gebiet),
        Body::GebietRemove { id, base_rev } => gebiet::remove(sql, cx, out, id, *base_rev),
        Body::Collect { gebiet } => collect::take(sql, cx, out, gebiet),
        Body::Release { gebiet } => collect::give_back(sql, cx, out, gebiet),
        Body::RunStart { run } => lauf::start(sql, cx, out, run),
        Body::RunUpdate { id, persons, join } => lauf::update(sql, cx, out, id, *persons, *join),
        Body::RunEnd { id } => lauf::end(sql, cx, out, id),
        Body::Cleanup { gebiet, keys, expect } => cleanup::clean(sql, cx, out, gebiet, keys.as_deref(), *expect),
        Body::Move { from, to, keys } => cleanup::hand_over(sql, cx, out, from, to, keys),
    }
}
