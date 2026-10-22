//! Brute-force brake: too many failures within a window lock a key (a hashed address, a sign-in name, an invitation prefix) for a while.
use flyermap_host::{
    db::{decode_one, stmt, Db, DbError},
    params,
};
use serde::Deserialize;

pub const MAX_FAILURES: u32 = 8;
pub const WINDOW_MS: u64 = 10 * 60_000;
pub const LOCK_MS: u64 = 10 * 60_000;

#[derive(Deserialize)]
struct Row {
    locked_until: Option<u64>,
}

/// `Some(until)` while the key is locked.
pub async fn locked_until<D: Db>(db: &D, key: &str, now: u64) -> Result<Option<u64>, DbError> {
    let row: Option<Row> = decode_one(db.first(&stmt("SELECT locked_until FROM throttle WHERE key = ?", params![key])).await?)?;
    match row.and_then(|r| r.locked_until) {
        Some(until) if until > now => Ok(Some(until)),
        Some(_) => {
            clear(db, key).await?;
            Ok(None)
        }
        None => Ok(None),
    }
}

/// One failed attempt, counted atomically.
pub async fn failed<D: Db>(db: &D, key: &str, now: u64) -> Result<(), DbError> {
    let fresh = "window_start + ? < ?";
    let sql = format!(
        "INSERT INTO throttle (key, failures, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           locked_until = CASE WHEN (CASE WHEN {fresh} THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END,
           failures = CASE WHEN {fresh} THEN 1 ELSE failures + 1 END,
           window_start = CASE WHEN {fresh} THEN ? ELSE window_start END"
    );
    let p = params![key, now, WINDOW_MS, now, MAX_FAILURES, now + LOCK_MS, WINDOW_MS, now, WINDOW_MS, now, now];
    db.batch(&[stmt(sql, p)]).await.map(|_| ())
}

pub async fn clear<D: Db>(db: &D, key: &str) -> Result<(), DbError> {
    db.batch(&[stmt("DELETE FROM throttle WHERE key = ?", params![key])]).await.map(|_| ())
}
