//! Notes. A deleted note stays as a tombstone with no content and the stamp that deleted it.
use super::{placeholders, scalar, tag, text_or_null, untag, IN_CHUNK};
use crate::sql::{Row, Sql, SqlError, Value};
use flyermap_protocol::{GebietId, Key, NoteId, Notiz, OpId};

const COLUMNS: &str = "id, key, gebiet, flag, text, rev, deleted, who";

fn read(r: &Row) -> Result<Notiz, SqlError> {
    Ok(Notiz {
        id: NoteId::new(r.text(0)?),
        key: Key::new(r.text(1)?),
        gebiet: GebietId::new(r.text(2)?),
        flag: r.opt_text(3)?.map(untag).transpose()?,
        text: r.text(4)?.to_string(),
        rev: OpId::new(r.text(5)?),
        deleted: r.flag(6)?,
        by: r.text(7)?.to_string(),
    })
}

pub fn get<S: Sql>(sql: &mut S, id: &NoteId) -> Result<Option<Notiz>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM notes WHERE id = ?"), &[Value::from(id.as_str())])?;
    rows.first().map(read).transpose()
}

/// Every row, tombstones included, by id.
pub fn all<S: Sql>(sql: &mut S) -> Result<Vec<Notiz>, SqlError> {
    sql.query(&format!("SELECT {COLUMNS} FROM notes ORDER BY id"), &[])?.iter().map(read).collect()
}

/// A page of the notes of a Gebiet that are not deleted, by id, after `after`.
pub fn page<S: Sql>(sql: &mut S, gebiet: &GebietId, after: Option<&NoteId>, limit: u32) -> Result<Vec<Notiz>, SqlError> {
    let rows = sql.query(
        &format!("SELECT {COLUMNS} FROM notes WHERE gebiet = ? AND deleted = 0 AND id > ? ORDER BY id LIMIT ?"),
        &[Value::from(gebiet.as_str()), Value::from(after.map_or("", NoteId::as_str)), Value::from(limit)],
    )?;
    rows.iter().map(read).collect()
}

/// Rows of the Gebiet including tombstones (the limit counts this).
pub fn count_rows<S: Sql>(sql: &mut S, gebiet: &GebietId) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM notes WHERE gebiet = ?", &[Value::from(gebiet.as_str())])?)?.max(0) as u32)
}

pub fn count_live<S: Sql>(sql: &mut S, gebiet: &GebietId) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM notes WHERE gebiet = ? AND deleted = 0", &[Value::from(gebiet.as_str())])?)?.max(0) as u32)
}

/// The notes of `gebiet` that are not deleted and sit on one of these keys.
pub fn on_keys<S: Sql>(sql: &mut S, gebiet: &GebietId, keys: &[Key]) -> Result<Vec<Notiz>, SqlError> {
    let mut out = Vec::new();
    for chunk in keys.chunks(IN_CHUNK) {
        let mut params = vec![Value::from(gebiet.as_str())];
        params.extend(chunk.iter().map(|k| Value::from(k.as_str())));
        let rows = sql
            .query(&format!("SELECT {COLUMNS} FROM notes WHERE gebiet = ? AND deleted = 0 AND key IN ({}) ORDER BY id", placeholders(chunk.len())), &params)?;
        for r in &rows {
            out.push(read(r)?);
        }
    }
    Ok(out)
}

/// Write a note if its stamp is not older than the stored one (a handed-over note arrives with the same stamp and another Gebiet).
pub fn upsert<S: Sql>(sql: &mut S, n: &Notiz) -> Result<(), SqlError> {
    sql.execute(
        "INSERT INTO notes (id, key, gebiet, flag, text, rev, deleted, who) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET key = excluded.key, gebiet = excluded.gebiet, flag = excluded.flag, text = excluded.text,
           rev = excluded.rev, deleted = excluded.deleted, who = excluded.who
         WHERE excluded.rev >= notes.rev",
        &[
            Value::from(n.id.as_str()),
            Value::from(n.key.as_str()),
            Value::from(n.gebiet.as_str()),
            text_or_null(n.flag.as_ref().map(tag).as_deref()),
            Value::from(n.text.as_str()),
            Value::from(n.rev.as_str()),
            Value::from(n.deleted),
            Value::from(n.by.as_str()),
        ],
    )
}

/// Clean these notes of `gebiet` away: no content, a tombstone with the stamp `rev`, unless something newer already sits there.
pub fn tombstone<S: Sql>(sql: &mut S, gebiet: &GebietId, ids: &[NoteId], rev: &OpId, who: &str) -> Result<(), SqlError> {
    for chunk in ids.chunks(IN_CHUNK) {
        let mut params = vec![Value::from(rev.as_str()), Value::from(who), Value::from(gebiet.as_str()), Value::from(rev.as_str())];
        params.extend(chunk.iter().map(|id| Value::from(id.as_str())));
        sql.execute(
            &format!(
                "UPDATE notes SET deleted = 1, flag = NULL, text = '', rev = ?, who = ? WHERE gebiet = ? AND rev < ? AND id IN ({})",
                placeholders(chunk.len())
            ),
            &params,
        )?;
    }
    Ok(())
}
