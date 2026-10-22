use flyermap_host::{
    db::{decode, decode_one, stmt, Db, DbError, Stmt},
    params,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AktionRow {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub created_by: String,
    pub created_at: u64,
    pub archived_at: Option<u64>,
}

const COLUMNS: &str = "id, org_id, name, created_by, created_at, archived_at";

pub fn insert_organisation_stmt(id: &str, name: &str, now: u64) -> Stmt {
    stmt("INSERT INTO organisations (id, name, created_at) VALUES (?, ?, ?)", params![id, name, now])
}

pub async fn organisation_name<D: Db>(db: &D, id: &str) -> Result<Option<String>, DbError> {
    #[derive(Deserialize)]
    struct N {
        name: String,
    }
    Ok(decode_one::<N>(db.first(&stmt("SELECT name FROM organisations WHERE id = ?", params![id])).await?)?.map(|n| n.name))
}

pub async fn insert<D: Db>(db: &D, row: &AktionRow) -> Result<(), DbError> {
    let sql = "INSERT INTO aktionen (id, org_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)";
    db.batch(&[stmt(sql, params![row.id.as_str(), row.org_id.as_str(), row.name.as_str(), row.created_by.as_str(), row.created_at])]).await.map(|_| ())
}

pub async fn get<D: Db>(db: &D, id: &str) -> Result<Option<AktionRow>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM aktionen WHERE id = ?"), params![id])).await?)
}

pub async fn of_org<D: Db>(db: &D, org_id: &str) -> Result<Vec<AktionRow>, DbError> {
    decode(db.all(&stmt(format!("SELECT {COLUMNS} FROM aktionen WHERE org_id = ? ORDER BY archived_at IS NOT NULL, created_at, id"), params![org_id])).await?)
}

pub async fn archive<D: Db>(db: &D, id: &str, now: u64) -> Result<bool, DbError> {
    Ok(db.batch(&[stmt("UPDATE aktionen SET archived_at = ? WHERE id = ? AND archived_at IS NULL", params![now, id])]).await?.first() == Some(&1))
}
