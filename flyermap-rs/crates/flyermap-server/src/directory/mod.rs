//! Queries on the directory database, one file per table. Handlers never write SQL; they call these.
pub mod aktionen;
pub mod audit;
pub mod challenges;
pub mod credentials;
pub mod grants;
pub mod invites;
pub mod persons;
pub mod sessions;
pub mod throttle;

use flyermap_host::db::{Db, DbError};

/// Applies the schema to an empty database (tests, local tools).
pub async fn install<D: Db>(db: &D) -> Result<(), DbError> {
    // whole-line comments go first: they may hold semicolons
    let code: String = crate::SCHEMA.lines().filter(|l| !l.trim_start().starts_with("--")).collect::<Vec<_>>().join("\n");
    let statements: Vec<_> = code.split(';').filter(|s| !s.trim().is_empty()).map(|s| flyermap_host::db::stmt(s, Vec::new())).collect();
    db.batch(&statements).await.map(|_| ())
}
