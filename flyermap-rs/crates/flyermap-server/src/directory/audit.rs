//! The log of who did what. It names ids and actions, never secrets or the texts of users.
use flyermap_host::{
    db::{decode, stmt, Db, DbError, Stmt},
    params,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub seq: u64,
    pub at: u64,
    pub actor: Option<String>,
    pub org_id: Option<String>,
    pub aktion_id: Option<String>,
    pub action: String,
    pub target: Option<String>,
    pub detail: Option<String>,
}

/// What happened. Fields not needed stay `None`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Event<'a> {
    pub actor: Option<&'a str>,
    pub org: Option<&'a str>,
    pub aktion: Option<&'a str>,
    pub action: &'a str,
    pub target: Option<&'a str>,
    pub detail: Option<&'a str>,
}

/// The statement that records one event (so it can be part of the batch that makes the change).
pub fn record_stmt(at: u64, e: &Event<'_>) -> Stmt {
    let o = |s: Option<&str>| s.map(str::to_string);
    stmt(
        "INSERT INTO audit (at, actor, org_id, aktion_id, action, target, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![at, o(e.actor), o(e.org), o(e.aktion), e.action, o(e.target), o(e.detail)],
    )
}

pub async fn record<D: Db>(db: &D, at: u64, e: &Event<'_>) -> Result<(), DbError> {
    db.batch(&[record_stmt(at, e)]).await.map(|_| ())
}

/// Newest first, `before` is the `seq` to continue from.
pub async fn list<D: Db>(db: &D, org_id: &str, before: Option<u64>, limit: u32) -> Result<Vec<Entry>, DbError> {
    let sql = "SELECT seq, at, actor, org_id, aktion_id, action, target, detail FROM audit WHERE org_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?";
    decode(db.all(&stmt(sql, params![org_id, before.unwrap_or(u64::MAX >> 1), limit.min(200)])).await?)
}

/// Newest first: what one person did with their own account (sign-ins, second factor, devices), for them alone.
pub async fn list_by_actor<D: Db>(db: &D, actor: &str, before: Option<u64>, limit: u32) -> Result<Vec<Entry>, DbError> {
    let sql = "SELECT seq, at, actor, org_id, aktion_id, action, target, detail FROM audit WHERE actor = ? AND seq < ? ORDER BY seq DESC LIMIT ?";
    decode(db.all(&stmt(sql, params![actor, before.unwrap_or(u64::MAX >> 1), limit.min(200)])).await?)
}
