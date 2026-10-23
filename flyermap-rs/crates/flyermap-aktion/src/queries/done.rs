//! Idempotency: the answers given to commands, by (principal, command id).
use crate::sql::{Sql, SqlError, Value};

/// What was answered, and the fingerprint of the command it was answered to.
pub struct Done {
    pub fingerprint: String,
    pub answer: String,
}

pub fn get<S: Sql>(sql: &mut S, who: &str, cid: &str) -> Result<Option<Done>, SqlError> {
    let rows = sql.query("SELECT fp, answer FROM done WHERE who = ? AND cid = ?", &[Value::from(who), Value::from(cid)])?;
    rows.first().map(|r| Ok(Done { fingerprint: r.text(0)?.to_string(), answer: r.text(1)?.to_string() })).transpose()
}

pub fn put<S: Sql>(sql: &mut S, who: &str, cid: &str, fingerprint: &str, answer: &str, at: u64) -> Result<(), SqlError> {
    sql.execute(
        "INSERT INTO done (who, cid, fp, answer, at) VALUES (?, ?, ?, ?, ?)",
        &[Value::from(who), Value::from(cid), Value::from(fingerprint), Value::from(answer), Value::from(at)],
    )
}

/// Forget what was answered before `before` (ms).
pub fn prune<S: Sql>(sql: &mut S, before: u64) -> Result<(), SqlError> {
    sql.execute("DELETE FROM done WHERE at < ?", &[Value::from(before)])
}

pub fn count<S: Sql>(sql: &mut S) -> Result<u64, SqlError> {
    super::scalar(&sql.query("SELECT COUNT(*) FROM done", &[])?).map(|n| n.max(0) as u64)
}
