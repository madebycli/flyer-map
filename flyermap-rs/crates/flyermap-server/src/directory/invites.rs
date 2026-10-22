//! Invitations. The code is never stored, only its hash; redeeming is one guarded update, so two devices cannot use the last place together.
use flyermap_host::{
    db::{decode, decode_one, stmt, Db, DbError},
    params,
};
use flyermap_identity::{invite::Invite, Role, Scope};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InviteRow {
    pub id: String,
    pub code_hash: String,
    pub role: String,
    pub scope_kind: String,
    pub org_id: String,
    pub aktion_id: Option<String>,
    pub gruppe_id: Option<String>,
    pub gebiet_id: Option<String>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub not_after: Option<u64>,
    pub grant_ttl_ms: Option<u64>,
    pub label: String,
    pub created_by: String,
    pub created_at: u64,
    pub revoked_at: Option<u64>,
}

const COLUMNS: &str = "id, code_hash, role, scope_kind, org_id, aktion_id, gruppe_id, gebiet_id, max_uses, uses, not_after, grant_ttl_ms, label, created_by, created_at, revoked_at";

impl InviteRow {
    pub fn invite(&self) -> Option<Invite> {
        let scope = Scope::from_columns(&self.scope_kind, &self.org_id, self.aktion_id.as_deref(), self.gruppe_id.as_deref(), self.gebiet_id.as_deref())?;
        Some(Invite {
            role: Role::parse(&self.role)?,
            scope,
            max_uses: self.max_uses,
            uses: self.uses,
            not_after: self.not_after,
            grant_ttl_ms: self.grant_ttl_ms,
            revoked: self.revoked_at.is_some(),
        })
    }
}

pub async fn insert<D: Db>(db: &D, row: &InviteRow) -> Result<(), DbError> {
    let sql = "INSERT INTO invites (id, code_hash, role, scope_kind, org_id, aktion_id, gruppe_id, gebiet_id, max_uses, uses, not_after, grant_ttl_ms, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)";
    let p = params![
        row.id.as_str(),
        row.code_hash.as_str(),
        row.role.as_str(),
        row.scope_kind.as_str(),
        row.org_id.as_str(),
        row.aktion_id.clone(),
        row.gruppe_id.clone(),
        row.gebiet_id.clone(),
        row.max_uses,
        row.not_after,
        row.grant_ttl_ms,
        row.label.as_str(),
        row.created_by.as_str(),
        row.created_at
    ];
    db.batch(&[stmt(sql, p)]).await.map(|_| ())
}

pub async fn by_code_hash<D: Db>(db: &D, hash: &str) -> Result<Option<InviteRow>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM invites WHERE code_hash = ?"), params![hash])).await?)
}

pub async fn get<D: Db>(db: &D, id: &str) -> Result<Option<InviteRow>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM invites WHERE id = ?"), params![id])).await?)
}

/// Takes one place of the invitation. `false` when it was used up, revoked or expired in the meantime.
pub async fn take_place<D: Db>(db: &D, id: &str, now: u64) -> Result<bool, DbError> {
    let sql = "UPDATE invites SET uses = uses + 1 WHERE id = ? AND revoked_at IS NULL AND (max_uses IS NULL OR uses < max_uses) AND (not_after IS NULL OR not_after > ?)";
    Ok(db.batch(&[stmt(sql, params![id, now])]).await?.first() == Some(&1))
}

/// The invitations of an Aktion (live ones first).
pub async fn of_aktion<D: Db>(db: &D, org_id: &str, aktion_id: &str) -> Result<Vec<InviteRow>, DbError> {
    let sql = format!("SELECT {COLUMNS} FROM invites WHERE org_id = ? AND aktion_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC, id");
    decode(db.all(&stmt(sql, params![org_id, aktion_id])).await?)
}

pub async fn revoke<D: Db>(db: &D, id: &str, now: u64) -> Result<bool, DbError> {
    Ok(db.batch(&[stmt("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", params![now, id])]).await?.first() == Some(&1))
}
