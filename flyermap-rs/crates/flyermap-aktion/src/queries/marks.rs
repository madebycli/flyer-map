//! Marks: one row per key, the winner of the race (the newest stamp). A cleaned key stays as a tombstone (`removed`) carrying the stamp that removed it.
use super::{placeholders, scalar, IN_CHUNK};
use crate::sql::{Row, Sql, SqlError, Value};
use flyermap_core::{Key, OpId, Status};
use flyermap_protocol::{GebietId, Mark};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkRow {
    pub mark: Mark,
    pub removed: bool,
}

const COLUMNS: &str = "key, gebiet, status, op, who, removed";

fn read(r: &Row) -> Result<MarkRow, SqlError> {
    let status = Status::parse(r.text(2)?).ok_or_else(|| SqlError::new("unknown status in storage"))?;
    Ok(MarkRow {
        mark: Mark { key: Key::new(r.text(0)?), gebiet: GebietId::new(r.text(1)?), status, op: OpId::new(r.text(3)?), by: r.text(4)?.to_string() },
        removed: r.flag(5)?,
    })
}

fn wall_of(op: &OpId) -> u64 {
    op.decode().map_or(0, |c| c.wall)
}

fn keys_in<S: Sql>(sql: &mut S, head: &str, tail: &str, lead: &[Value], keys: &[Key]) -> Result<Vec<MarkRow>, SqlError> {
    let mut out = Vec::with_capacity(keys.len());
    for chunk in keys.chunks(IN_CHUNK) {
        let mut params = lead.to_vec();
        params.extend(chunk.iter().map(|k| Value::from(k.as_str())));
        let rows = sql.query(&format!("{head} IN ({}){tail}", placeholders(chunk.len())), &params)?;
        for r in &rows {
            out.push(read(r)?);
        }
    }
    Ok(out)
}

/// The rows for these keys, whoever owns them and whether or not they are tombstones.
pub fn get_many<S: Sql>(sql: &mut S, keys: &[Key]) -> Result<Vec<MarkRow>, SqlError> {
    keys_in(sql, &format!("SELECT {COLUMNS} FROM marks WHERE key"), "", &[], keys)
}

/// The live rows among these keys that belong to `gebiet`.
pub fn owned<S: Sql>(sql: &mut S, gebiet: &GebietId, keys: &[Key]) -> Result<Vec<MarkRow>, SqlError> {
    keys_in(sql, &format!("SELECT {COLUMNS} FROM marks WHERE gebiet = ? AND removed = 0 AND key"), "", &[Value::from(gebiet.as_str())], keys)
}

/// Every row, tombstones included, by key.
pub fn all<S: Sql>(sql: &mut S) -> Result<Vec<MarkRow>, SqlError> {
    sql.query(&format!("SELECT {COLUMNS} FROM marks ORDER BY key"), &[])?.iter().map(read).collect()
}

/// A page of the live marks of a Gebiet, by key, after `after`.
pub fn page<S: Sql>(sql: &mut S, gebiet: &GebietId, after: Option<&Key>, limit: u32) -> Result<Vec<Mark>, SqlError> {
    let rows = sql.query(
        &format!("SELECT {COLUMNS} FROM marks WHERE gebiet = ? AND removed = 0 AND key > ? ORDER BY key LIMIT ?"),
        &[Value::from(gebiet.as_str()), Value::from(after.map_or("", Key::as_str)), Value::from(limit)],
    )?;
    Ok(rows.iter().map(read).collect::<Result<Vec<_>, _>>()?.into_iter().map(|r| r.mark).collect())
}

/// Rows of the Gebiet including tombstones: what the Gebiet takes up (the limit counts this).
pub fn count_rows<S: Sql>(sql: &mut S, gebiet: &GebietId) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM marks WHERE gebiet = ?", &[Value::from(gebiet.as_str())])?)?.max(0) as u32)
}

pub fn count_live<S: Sql>(sql: &mut S, gebiet: &GebietId) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM marks WHERE gebiet = ? AND removed = 0", &[Value::from(gebiet.as_str())])?)?.max(0) as u32)
}

/// Write the race winner for `key` if its stamp is not older than the stored one. The same stamp for another Gebiet is a key handed over.
pub fn upsert<S: Sql>(sql: &mut S, gebiet: &GebietId, key: &Key, status: Status, op: &OpId, who: &str) -> Result<(), SqlError> {
    let house = key.kind() == Some(flyermap_core::EntityKind::House);
    sql.execute(
        "INSERT INTO marks (key, gebiet, status, op, wall, house, who, removed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (key) DO UPDATE SET gebiet = excluded.gebiet, status = excluded.status, op = excluded.op, wall = excluded.wall,
           house = excluded.house, who = excluded.who, removed = 0
         WHERE excluded.op >= marks.op",
        &[
            Value::from(key.as_str()),
            Value::from(gebiet.as_str()),
            Value::from(status.as_str()),
            Value::from(op.as_str()),
            Value::from(wall_of(op)),
            Value::from(house),
            Value::from(who),
        ],
    )
}

/// Clean these keys of `gebiet` away: a tombstone with the stamp `rev`, unless something newer already sits there.
pub fn tombstone<S: Sql>(sql: &mut S, gebiet: &GebietId, keys: &[Key], rev: &OpId, who: &str) -> Result<(), SqlError> {
    for chunk in keys.chunks(IN_CHUNK) {
        let mut params = vec![Value::from(rev.as_str()), Value::from(wall_of(rev)), Value::from(who), Value::from(gebiet.as_str()), Value::from(rev.as_str())];
        params.extend(chunk.iter().map(|k| Value::from(k.as_str())));
        sql.execute(
            &format!(
                "UPDATE marks SET status = 'open', op = ?, wall = ?, who = ?, removed = 1 WHERE gebiet = ? AND op < ? AND key IN ({})",
                placeholders(chunk.len())
            ),
            &params,
        )?;
    }
    Ok(())
}

/// Houses of the Gebiet completed by an edit stamped within `[from, to]` (ms; `to` open when `None`): what a Lauf has done.
pub fn done_between<S: Sql>(sql: &mut S, gebiet: &GebietId, from: u64, to: Option<u64>) -> Result<u32, SqlError> {
    let rows = sql.query(
        "SELECT COUNT(*) FROM marks WHERE gebiet = ? AND status = 'completed' AND house = 1 AND removed = 0 AND wall >= ? AND wall <= ?",
        &[Value::from(gebiet.as_str()), Value::from(from), Value::from(to.unwrap_or(crate::sql::MAX_SAFE_INT))],
    )?;
    Ok(scalar(&rows)?.max(0) as u32)
}
