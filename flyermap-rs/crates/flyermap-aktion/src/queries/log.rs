//! The log table: append, read a range, compact.
use crate::sql::{Sql, SqlError, Value};

/// A row as stored; the change is still JSON.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogRow {
    pub seq: u64,
    pub at: u64,
    pub who: String,
    pub change: String,
}

pub fn append<S: Sql>(sql: &mut S, seq: u64, at: u64, who: &str, change: &str) -> Result<(), SqlError> {
    sql.execute("INSERT INTO log (seq, at, who, change) VALUES (?, ?, ?, ?)", &[Value::from(seq), Value::from(at), Value::from(who), Value::from(change)])
}

/// The highest number in the log (0 when empty). Compaction always keeps the newest row, so this is the head.
pub fn head<S: Sql>(sql: &mut S) -> Result<u64, SqlError> {
    let rows = sql.query("SELECT COALESCE(MAX(seq), 0) FROM log", &[])?;
    rows.first().ok_or_else(|| SqlError::new("no row for the head"))?.uint(0)
}

/// Rows after `after`, oldest first, at most `limit`.
pub fn range<S: Sql>(sql: &mut S, after: u64, limit: u32) -> Result<Vec<LogRow>, SqlError> {
    let rows = sql.query("SELECT seq, at, who, change FROM log WHERE seq > ? ORDER BY seq LIMIT ?", &[Value::from(after), Value::from(limit)])?;
    rows.iter().map(|r| Ok(LogRow { seq: r.uint(0)?, at: r.uint(1)?, who: r.text(2)?.to_string(), change: r.text(3)?.to_string() })).collect()
}

/// Forget the rows up to and including `seq`.
pub fn delete_through<S: Sql>(sql: &mut S, seq: u64) -> Result<(), SqlError> {
    sql.execute("DELETE FROM log WHERE seq <= ?", &[Value::from(seq)])
}

/// How many rows, the lowest and the highest number (for the invariant check: they must agree).
pub fn shape<S: Sql>(sql: &mut S) -> Result<(u64, u64, u64), SqlError> {
    let rows = sql.query("SELECT COUNT(*), COALESCE(MIN(seq), 0), COALESCE(MAX(seq), 0) FROM log", &[])?;
    let r = rows.first().ok_or_else(|| SqlError::new("no row for the log shape"))?;
    Ok((r.uint(0)?, r.uint(1)?, r.uint(2)?))
}
