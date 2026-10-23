//! Läufe.
use super::{scalar, tag, untag};
use crate::sql::{Row, Sql, SqlError, Value};
use flyermap_protocol::{GebietId, Lauf, LaufId};

const COLUMNS: &str = "id, gebiet, persons, join_mode, status, started_at, ended_at, houses, who, rev";

fn read(r: &Row) -> Result<Lauf, SqlError> {
    let persons = u16::try_from(r.int(2)?).map_err(|_| SqlError::new("persons out of range"))?;
    Ok(Lauf {
        id: LaufId::new(r.text(0)?),
        gebiet: GebietId::new(r.text(1)?),
        persons,
        join: untag(r.text(3)?)?,
        status: untag(r.text(4)?)?,
        started_at: r.uint(5)?,
        ended_at: r.opt_uint(6)?,
        houses: u32::try_from(r.int(7)?).map_err(|_| SqlError::new("houses out of range"))?,
        by: r.text(8)?.to_string(),
        rev: r.uint(9)?,
    })
}

pub fn get<S: Sql>(sql: &mut S, id: &LaufId) -> Result<Option<Lauf>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM runs WHERE id = ?"), &[Value::from(id.as_str())])?;
    rows.first().map(read).transpose()
}

pub fn all<S: Sql>(sql: &mut S) -> Result<Vec<Lauf>, SqlError> {
    sql.query(&format!("SELECT {COLUMNS} FROM runs ORDER BY id"), &[])?.iter().map(read).collect()
}

/// The running Lauf of a Gebiet, if any.
pub fn active_of<S: Sql>(sql: &mut S, gebiet: &GebietId) -> Result<Option<Lauf>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM runs WHERE gebiet = ? AND status = 'active'"), &[Value::from(gebiet.as_str())])?;
    rows.first().map(read).transpose()
}

/// The Läufe of a Gebiet whose window meets `[lo, hi]`: the ones a mark stamped within it can count for.
pub fn meeting<S: Sql>(sql: &mut S, gebiet: &GebietId, lo: u64, hi: u64) -> Result<Vec<Lauf>, SqlError> {
    let rows = sql.query(
        &format!("SELECT {COLUMNS} FROM runs WHERE gebiet = ? AND started_at <= ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY id"),
        &[Value::from(gebiet.as_str()), Value::from(hi), Value::from(lo)],
    )?;
    rows.iter().map(read).collect()
}

/// Running Läufe, and those that ended at or after `ended_since`.
pub fn recent<S: Sql>(sql: &mut S, ended_since: u64) -> Result<Vec<Lauf>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM runs WHERE status = 'active' OR ended_at >= ? ORDER BY id"), &[Value::from(ended_since)])?;
    rows.iter().map(read).collect()
}

pub fn count_active<S: Sql>(sql: &mut S) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM runs WHERE status = 'active'", &[])?)?.max(0) as u32)
}

/// Write the state of a Lauf if its revision is not older than the stored one.
pub fn upsert<S: Sql>(sql: &mut S, l: &Lauf) -> Result<(), SqlError> {
    sql.execute(
        "INSERT INTO runs (id, gebiet, persons, join_mode, status, started_at, ended_at, houses, who, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET persons = excluded.persons, join_mode = excluded.join_mode, status = excluded.status,
           ended_at = excluded.ended_at, houses = excluded.houses, rev = excluded.rev
         WHERE excluded.rev >= runs.rev",
        &[
            Value::from(l.id.as_str()),
            Value::from(l.gebiet.as_str()),
            Value::from(l.persons),
            Value::from(tag(&l.join)),
            Value::from(tag(&l.status)),
            Value::from(l.started_at),
            Value::from(l.ended_at),
            Value::from(l.houses),
            Value::from(l.by.as_str()),
            Value::from(l.rev),
        ],
    )
}
