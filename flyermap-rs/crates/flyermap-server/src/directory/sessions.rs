//! One row per signed-in device. Only the hash of the token is stored; the token itself lives on the device.
use flyermap_host::{
    db::{decode, decode_one, stmt, Db, DbError},
    params,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub person_id: String,
    pub label: String,
    pub via: String,
    pub created_at: u64,
    pub last_seen_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
}

const COLUMNS: &str = "id, person_id, label, via, created_at, last_seen_at, expires_at, revoked_at";

pub async fn insert<D: Db>(db: &D, s: &Session, token_hash: &str) -> Result<(), DbError> {
    let sql = "INSERT INTO sessions (id, person_id, token_hash, label, via, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    let p = params![s.id.as_str(), s.person_id.as_str(), token_hash, s.label.as_str(), s.via.as_str(), s.created_at, s.last_seen_at, s.expires_at];
    db.batch(&[stmt(sql, p)]).await.map(|_| ())
}

/// The live session behind a token hash: not revoked, not expired, person not disabled.
pub async fn live_by_token<D: Db>(db: &D, token_hash: &str, now: u64) -> Result<Option<Session>, DbError> {
    let sql = format!(
        "SELECT {} FROM sessions s WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = s.person_id AND p.disabled_at IS NOT NULL)",
        COLUMNS.split(", ").map(|c| format!("s.{c}")).collect::<Vec<_>>().join(", ")
    );
    decode_one(db.first(&stmt(sql, params![token_hash, now])).await?)
}

/// Keeps a session alive while it is used, but writes at most once a minute.
pub async fn touch<D: Db>(db: &D, id: &str, now: u64, ttl_ms: u64) -> Result<(), DbError> {
    let sql = "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND last_seen_at < ?";
    db.batch(&[stmt(sql, params![now, now + ttl_ms, id, now.saturating_sub(60_000)])]).await.map(|_| ())
}

pub async fn of_person<D: Db>(db: &D, person_id: &str, now: u64) -> Result<Vec<Session>, DbError> {
    let sql = format!("SELECT {COLUMNS} FROM sessions WHERE person_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC, id");
    decode(db.all(&stmt(sql, params![person_id, now])).await?)
}

/// `true` when the person's own session was revoked.
pub async fn revoke<D: Db>(db: &D, person_id: &str, id: &str, now: u64) -> Result<bool, DbError> {
    let sql = "UPDATE sessions SET revoked_at = ? WHERE id = ? AND person_id = ? AND revoked_at IS NULL";
    Ok(db.batch(&[stmt(sql, params![now, id, person_id])]).await?.first() == Some(&1))
}

/// All sessions of the person except one (after a password change, "sign out everywhere else").
pub async fn revoke_others<D: Db>(db: &D, person_id: &str, keep: &str, now: u64) -> Result<u64, DbError> {
    let sql = "UPDATE sessions SET revoked_at = ? WHERE person_id = ? AND id <> ? AND revoked_at IS NULL";
    Ok(db.batch(&[stmt(sql, params![now, person_id, keep])]).await?.first().copied().unwrap_or(0))
}

pub async fn revoke_all<D: Db>(db: &D, person_id: &str, now: u64) -> Result<u64, DbError> {
    let sql = "UPDATE sessions SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL";
    Ok(db.batch(&[stmt(sql, params![now, person_id])]).await?.first().copied().unwrap_or(0))
}
