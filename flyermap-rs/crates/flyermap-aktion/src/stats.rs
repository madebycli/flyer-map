//! The statistic of a Lauf: the houses of its Gebiet that stand completed now by an edit stamped within the Lauf's window (from the start to the end, or
//! still open). It is counted from the marks each time it may have changed and never added up from changes, so a repeated delivery, an edit that arrives
//! late from a phone that was offline, or an edit undone cannot skew it. A Lauf whose number changed gets a new entry.
use crate::{
    fail::R,
    out::Out,
    queries::{marks, runs},
    sql::Sql,
};
use flyermap_protocol::{Change, GebietId, Lauf};

/// Count again every Lauf of the Gebiet whose window meets `[lo, hi]` (ms): those are the ones an edit stamped in that span can have changed.
pub(crate) fn recount<S: Sql>(sql: &mut S, out: &mut Out, gebiet: &GebietId, lo: u64, hi: u64) -> R<()> {
    for lauf in runs::meeting(sql, gebiet, lo, hi)? {
        let houses = marks::done_between(sql, gebiet, lauf.started_at, lauf.ended_at)?;
        if houses != lauf.houses {
            out.emit(sql, Change::LaufSet { lauf: Lauf { houses, rev: lauf.rev + 1, ..lauf } })?;
        }
    }
    Ok(())
}

/// Count again all Läufe of the Gebiet (marks were cleaned away or handed over).
pub(crate) fn recount_all<S: Sql>(sql: &mut S, out: &mut Out, gebiet: &GebietId) -> R<()> {
    recount(sql, out, gebiet, 0, u64::MAX)
}
