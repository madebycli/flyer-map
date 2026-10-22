//! The tables of one Aktion (Plan 061 §4). Written for SQLite as both hosts have it: no pragma, no triggers, no functions beyond the basics.
//!
//! Nothing is ever deleted from the tables of state: a thing that goes away stays as a tombstone (`deleted`, `removed`) with the stamp that removed
//! it, so that devices can fetch the news and an old edit cannot bring it back. Only `log` (compaction) and `done` (idempotency keys that ran out) lose rows.
//! Rights are not in here: no column says who may see what. The Akteur asks `flyermap_identity::decide` and passes the answer to the queries as plain ids.
use crate::sql::{Sql, SqlError};

/// The version of this layout, kept in `meta`.
pub const VERSION: i64 = 1;

const STATEMENTS: &[&str] = &[
    // key/value: schema, org, aktion, clock (the Akteur's own stamp), floor (log entries up to it are compacted away)
    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID",
    "CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL
    ) WITHOUT ROWID",
    // ring: JSON [[lng,lat],...]; the bounding box lets overlap checks load only the neighbours
    "CREATE TABLE IF NOT EXISTS areas (
        id TEXT PRIMARY KEY, art TEXT NOT NULL, gruppe TEXT, parent TEXT, name TEXT NOT NULL, ring TEXT NOT NULL,
        rev INTEGER NOT NULL, deleted INTEGER NOT NULL, collected_by TEXT, collected_at INTEGER,
        min_lng REAL NOT NULL, min_lat REAL NOT NULL, max_lng REAL NOT NULL, max_lat REAL NOT NULL
    ) WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS areas_by_parent ON areas (parent) WHERE parent IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS areas_by_gruppe ON areas (gruppe) WHERE gruppe IS NOT NULL",
    // one row per key: the winner of the race. wall: the wall-clock part of op (ms); house: 1 for h:, 0 for s:; removed: tombstone of a clean-up
    "CREATE TABLE IF NOT EXISTS marks (
        key TEXT PRIMARY KEY, gebiet TEXT NOT NULL, status TEXT NOT NULL, op TEXT NOT NULL, wall INTEGER NOT NULL,
        house INTEGER NOT NULL, who TEXT NOT NULL, removed INTEGER NOT NULL
    ) WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS marks_by_gebiet ON marks (gebiet, key)",
    // the houses done within a window of a Lauf are counted from here
    "CREATE INDEX IF NOT EXISTS marks_done ON marks (gebiet, wall) WHERE status = 'completed' AND house = 1 AND removed = 0",
    "CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, key TEXT NOT NULL, gebiet TEXT NOT NULL, flag TEXT, text TEXT NOT NULL, rev TEXT NOT NULL,
        deleted INTEGER NOT NULL, who TEXT NOT NULL
    ) WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS notes_by_gebiet ON notes (gebiet, id)",
    "CREATE INDEX IF NOT EXISTS notes_by_key ON notes (gebiet, key)",
    "CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, gebiet TEXT NOT NULL, persons INTEGER NOT NULL, join_mode TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, houses INTEGER NOT NULL, who TEXT NOT NULL, rev INTEGER NOT NULL
    ) WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS runs_by_gebiet ON runs (gebiet)",
    "CREATE INDEX IF NOT EXISTS runs_active ON runs (gebiet) WHERE status = 'active'",
    // the log: seq has no gaps. change: JSON of the protocol's Change
    "CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, who TEXT NOT NULL, change TEXT NOT NULL)",
    // idempotency: the answer given to a command, kept for a while so that a retry gets the same answer and changes nothing
    "CREATE TABLE IF NOT EXISTS done (
        who TEXT NOT NULL, cid TEXT NOT NULL, fp TEXT NOT NULL, answer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (who, cid)
    ) WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS done_by_at ON done (at)",
];

/// Create what is missing. Safe to call on every start.
pub(crate) fn install<S: Sql>(sql: &mut S) -> Result<(), SqlError> {
    for statement in STATEMENTS {
        sql.execute(statement, &[])?;
    }
    Ok(())
}
