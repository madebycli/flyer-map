//! Challenges for passkey ceremonies: made, handed to the browser, and taken back exactly once.
use flyermap_host::{
    db::{decode_one, stmt, Db, DbError},
    params,
};
use serde::Deserialize;

pub const LIFETIME_MS: u64 = 5 * 60_000;

pub async fn put<D: Db>(db: &D, id: &str, kind: &str, person_id: Option<&str>, challenge: &str, now: u64) -> Result<(), DbError> {
    let sql = "INSERT INTO challenges (id, kind, person_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)";
    // old ones go with every new one: no job needed
    db.batch(&[
        stmt("DELETE FROM challenges WHERE expires_at <= ?", params![now]),
        stmt(sql, params![id, kind, person_id.map(str::to_string), challenge, now + LIFETIME_MS]),
    ])
    .await
    .map(|_| ())
}

#[derive(Deserialize)]
pub struct Taken {
    pub person_id: Option<String>,
    pub challenge: String,
}

/// Returns the challenge once; a second call (a replay) finds nothing.
pub async fn take<D: Db>(db: &D, id: &str, kind: &str, now: u64) -> Result<Option<Taken>, DbError> {
    let found: Option<Taken> =
        decode_one(db.first(&stmt("SELECT person_id, challenge FROM challenges WHERE id = ? AND kind = ? AND expires_at > ?", params![id, kind, now])).await?)?;
    if found.is_none() {
        return Ok(None);
    }
    let removed = db.batch(&[stmt("DELETE FROM challenges WHERE id = ?", params![id])]).await?;
    Ok(if removed.first() == Some(&1) { found } else { None })
}
