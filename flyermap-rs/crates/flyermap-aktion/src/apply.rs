//! A change of the log as a change of the tables. This is the one function that writes state, and it is what the log means: whatever a command decided, only
//! the entries it produced reach the tables, in this way. Replay is nothing but this function over the entries.
use crate::{
    queries::{areas, groups, marks, notes, runs},
    sql::{Sql, SqlError},
};
use flyermap_protocol::{Change, Collected, Entry};

pub(crate) fn apply<S: Sql>(sql: &mut S, entry: &Entry) -> Result<(), SqlError> {
    let by = entry.by.as_str();
    match &entry.change {
        Change::MarkSet { gebiet, key, status, op } => marks::upsert(sql, gebiet, key, *status, op, by),
        Change::MarksRemoved { gebiet, keys, rev } => marks::tombstone(sql, gebiet, keys, rev, by),
        Change::NoteSet { note } => notes::upsert(sql, note),
        // the marks and notes were written, in the new Gebiet, by the entries that come with this one; this one is only for the readers of the old
        Change::HandedOver { .. } => Ok(()),
        Change::NotesRemoved { gebiet, ids, rev } => notes::tombstone(sql, gebiet, ids, rev, by),
        Change::GruppeSet { gruppe } => groups::upsert(sql, gruppe),
        Change::GruppeRemoved { id, rev } => groups::tombstone(sql, id, *rev),
        Change::GebietSet { gebiet } => areas::upsert(sql, gebiet),
        Change::GebietRemoved { id, rev } => areas::tombstone(sql, id, *rev),
        Change::Collected { gebiet, by, at } => areas::set_collected(sql, gebiet, Some(&Collected { by: by.clone(), at: *at })),
        Change::Released { gebiet } => areas::set_collected(sql, gebiet, None),
        Change::LaufSet { lauf } | Change::LaufEnded { lauf } => runs::upsert(sql, lauf),
    }
}
