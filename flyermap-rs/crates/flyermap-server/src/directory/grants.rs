//! What people may do, and where (see `flyermap-identity`). A grant is revoked, never deleted: the audit log refers to it.
use flyermap_host::{
    db::{decode, stmt, Db, DbError, Stmt},
    params,
};
use flyermap_identity::{Grant, Role, Scope};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrantRow {
    pub id: String,
    pub person_id: String,
    pub role: String,
    pub scope_kind: String,
    pub org_id: String,
    pub aktion_id: Option<String>,
    pub gruppe_id: Option<String>,
    pub gebiet_id: Option<String>,
    pub not_after: Option<u64>,
    pub created_by: Option<String>,
    pub created_at: u64,
    pub revoked_at: Option<u64>,
    pub invite_id: Option<String>,
}

const COLUMNS: &str = "id, person_id, role, scope_kind, org_id, aktion_id, gruppe_id, gebiet_id, not_after, created_by, created_at, revoked_at, invite_id";

impl GrantRow {
    /// The grant as the rights code sees it; `None` for a row that is not one (a role or scope that does not exist).
    pub fn grant(&self) -> Option<Grant> {
        let scope = Scope::from_columns(&self.scope_kind, &self.org_id, self.aktion_id.as_deref(), self.gruppe_id.as_deref(), self.gebiet_id.as_deref())?;
        Some(Grant { role: Role::parse(&self.role)?, scope, not_after: self.not_after })
    }
}

/// The statement that writes a grant (used alone, or inside a larger batch).
pub fn insert_stmt(id: &str, person_id: &str, grant: &Grant, created_by: Option<&str>, invite_id: Option<&str>, now: u64) -> Stmt {
    let c = grant.scope.columns();
    let sql = "INSERT INTO grants (id, person_id, role, scope_kind, org_id, aktion_id, gruppe_id, gebiet_id, not_after, created_by, created_at, invite_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    stmt(
        sql,
        params![
            id,
            person_id,
            grant.role.as_str(),
            c.kind,
            c.org,
            c.aktion,
            c.gruppe,
            c.gebiet,
            grant.not_after,
            created_by.map(str::to_string),
            now,
            invite_id.map(str::to_string)
        ],
    )
}

pub async fn insert<D: Db>(db: &D, id: &str, person_id: &str, grant: &Grant, created_by: Option<&str>, now: u64) -> Result<(), DbError> {
    db.batch(&[insert_stmt(id, person_id, grant, created_by, None, now)]).await.map(|_| ())
}

/// The rows of a person that count now (not revoked, not expired).
pub async fn live_rows<D: Db>(db: &D, person_id: &str, now: u64) -> Result<Vec<GrantRow>, DbError> {
    let sql =
        format!("SELECT {COLUMNS} FROM grants WHERE person_id = ? AND revoked_at IS NULL AND (not_after IS NULL OR not_after > ?) ORDER BY created_at, id");
    decode(db.all(&stmt(sql, params![person_id, now])).await?)
}

/// Everybody who holds a live grant in an Aktion (for the list of people), with who they are.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    #[serde(flatten)]
    pub grant: GrantRow,
    pub display_name: String,
    pub kind: String,
}

pub async fn members_of_aktion<D: Db>(db: &D, org_id: &str, aktion_id: &str, now: u64) -> Result<Vec<Member>, DbError> {
    let sql = "SELECT g.id, g.person_id, g.role, g.scope_kind, g.org_id, g.aktion_id, g.gruppe_id, g.gebiet_id, g.not_after, g.created_by, g.created_at, g.revoked_at, g.invite_id, p.display_name, p.kind
       FROM grants g JOIN persons p ON p.id = g.person_id
      WHERE g.org_id = ? AND g.revoked_at IS NULL AND (g.not_after IS NULL OR g.not_after > ?) AND p.disabled_at IS NULL
        AND (g.scope_kind = 'organisation' OR g.aktion_id = ?)
      ORDER BY g.created_at, g.id";
    decode(db.all(&stmt(sql, params![org_id, now, aktion_id])).await?)
}

pub async fn get<D: Db>(db: &D, id: &str) -> Result<Option<GrantRow>, DbError> {
    flyermap_host::db::decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM grants WHERE id = ?"), params![id])).await?)
}

pub async fn revoke<D: Db>(db: &D, id: &str, now: u64) -> Result<bool, DbError> {
    Ok(db.batch(&[stmt("UPDATE grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", params![now, id])]).await?.first() == Some(&1))
}

/// Ends all grants that came with a Lauf-invitation when the Lauf ends (the invitations of a Lauf are tagged with its invite ids).
pub async fn revoke_by_invite<D: Db>(db: &D, invite_id: &str, now: u64) -> Result<u64, DbError> {
    Ok(db
        .batch(&[stmt("UPDATE grants SET revoked_at = ? WHERE invite_id = ? AND revoked_at IS NULL", params![now, invite_id])])
        .await?
        .first()
        .copied()
        .unwrap_or(0))
}

/// How many live owners the Organisation has (the last one cannot be removed).
pub async fn count_live_owners<D: Db>(db: &D, org_id: &str, now: u64) -> Result<u32, DbError> {
    #[derive(Deserialize)]
    struct N {
        n: u32,
    }
    let sql = "SELECT COUNT(DISTINCT person_id) AS n FROM grants WHERE org_id = ? AND role = 'owner' AND scope_kind = 'organisation' AND revoked_at IS NULL AND (not_after IS NULL OR not_after > ?)";
    Ok(flyermap_host::db::decode_one::<N>(db.first(&stmt(sql, params![org_id, now])).await?)?.map_or(0, |r| r.n))
}
