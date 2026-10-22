//! Gruppen.
use super::scalar;
use crate::sql::{Row, Sql, SqlError, Value};
use flyermap_protocol::{Gruppe, GruppeId};

/// A Gruppe as stored: deleted ones stay as tombstones with the revision that deleted them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupRow {
    pub gruppe: Gruppe,
    pub deleted: bool,
}

const COLUMNS: &str = "id, name, color, rev, deleted";

fn read(r: &Row) -> Result<GroupRow, SqlError> {
    let color = u8::try_from(r.int(2)?).map_err(|_| SqlError::new("colour out of range"))?;
    Ok(GroupRow { gruppe: Gruppe { id: GruppeId::new(r.text(0)?), name: r.text(1)?.to_string(), color, rev: r.uint(3)? }, deleted: r.flag(4)? })
}

pub fn get<S: Sql>(sql: &mut S, id: &GruppeId) -> Result<Option<GroupRow>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM groups WHERE id = ?"), &[Value::from(id.as_str())])?;
    rows.first().map(read).transpose()
}

/// Every row, tombstones included, by id.
pub fn all<S: Sql>(sql: &mut S) -> Result<Vec<GroupRow>, SqlError> {
    sql.query(&format!("SELECT {COLUMNS} FROM groups ORDER BY id"), &[])?.iter().map(read).collect()
}

pub fn live<S: Sql>(sql: &mut S) -> Result<Vec<Gruppe>, SqlError> {
    Ok(sql.query(&format!("SELECT {COLUMNS} FROM groups WHERE deleted = 0 ORDER BY id"), &[])?.iter().map(read).collect::<Result<Vec<_>, _>>()?.into_iter().map(|r| r.gruppe).collect())
}

pub fn count_live<S: Sql>(sql: &mut S) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM groups WHERE deleted = 0", &[])?)?.max(0) as u32)
}

/// Write the state of a Gruppe if its revision is not older than the stored one (the same entry twice changes nothing).
pub fn upsert<S: Sql>(sql: &mut S, g: &Gruppe) -> Result<(), SqlError> {
    sql.execute(
        "INSERT INTO groups (id, name, color, rev, deleted) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color, rev = excluded.rev
         WHERE excluded.rev >= groups.rev",
        &[Value::from(g.id.as_str()), Value::from(g.name.as_str()), Value::from(g.color), Value::from(g.rev)],
    )
}

pub fn tombstone<S: Sql>(sql: &mut S, id: &GruppeId, rev: u64) -> Result<(), SqlError> {
    sql.execute("UPDATE groups SET deleted = 1, rev = ? WHERE id = ? AND rev <= ?", &[Value::from(rev), Value::from(id.as_str()), Value::from(rev)])
}
