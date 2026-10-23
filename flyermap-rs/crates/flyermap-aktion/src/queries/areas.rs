//! Gebiete.
use super::{json, scalar, tag, text_or_null, unjson, untag};
use crate::sql::{Row, Sql, SqlError, Value};
use flyermap_protocol::{Art, Collected, Gebiet, GebietId, GruppeId, Ring};

/// A Gebiet as stored: deleted ones stay as tombstones (with the revision that deleted them) so that marks and notes still know their owner.
#[derive(Clone, Debug, PartialEq)]
pub struct AreaRow {
    pub gebiet: Gebiet,
    pub deleted: bool,
}

/// What the rights need to know about a Gebiet, and nothing else.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Facts {
    pub id: GebietId,
    pub art: Art,
    pub gruppe: Option<GruppeId>,
}

const COLUMNS: &str = "id, art, gruppe, parent, name, ring, rev, deleted, collected_by, collected_at";

fn read(r: &Row) -> Result<AreaRow, SqlError> {
    let collected = match r.opt_text(8)? {
        Some(by) => Some(Collected { by: by.to_string(), at: r.opt_uint(9)?.unwrap_or(0) }),
        None => None,
    };
    Ok(AreaRow {
        gebiet: Gebiet {
            id: GebietId::new(r.text(0)?),
            art: untag(r.text(1)?)?,
            gruppe: r.opt_text(2)?.map(GruppeId::new),
            parent: r.opt_text(3)?.map(GebietId::new),
            name: r.text(4)?.to_string(),
            ring: unjson(r.text(5)?)?,
            rev: r.uint(6)?,
            collected,
        },
        deleted: r.flag(7)?,
    })
}

/// `[min_lng, min_lat, max_lng, max_lat]`
pub fn bbox(ring: &Ring) -> [f64; 4] {
    ring.iter()
        .fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, p| [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])])
}

pub fn get<S: Sql>(sql: &mut S, id: &GebietId) -> Result<Option<AreaRow>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM areas WHERE id = ?"), &[Value::from(id.as_str())])?;
    rows.first().map(read).transpose()
}

/// Every row, tombstones included, by id.
pub fn all<S: Sql>(sql: &mut S) -> Result<Vec<AreaRow>, SqlError> {
    sql.query(&format!("SELECT {COLUMNS} FROM areas ORDER BY id"), &[])?.iter().map(read).collect()
}

/// Rows that are not deleted, by id.
pub fn live<S: Sql>(sql: &mut S) -> Result<Vec<Gebiet>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM areas WHERE deleted = 0 ORDER BY id"), &[])?;
    Ok(rows.iter().map(read).collect::<Result<Vec<_>, _>>()?.into_iter().map(|r| r.gebiet).collect())
}

pub fn count_live<S: Sql>(sql: &mut S) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM areas WHERE deleted = 0", &[])?)?.max(0) as u32)
}

pub fn count_live_in_gruppe<S: Sql>(sql: &mut S, gruppe: &GruppeId) -> Result<u32, SqlError> {
    Ok(scalar(&sql.query("SELECT COUNT(*) FROM areas WHERE deleted = 0 AND gruppe = ?", &[Value::from(gruppe.as_str())])?)?.max(0) as u32)
}

/// The sub-areas of a main area that are not deleted.
pub fn live_children<S: Sql>(sql: &mut S, parent: &GebietId) -> Result<Vec<Gebiet>, SqlError> {
    let rows = sql.query(&format!("SELECT {COLUMNS} FROM areas WHERE deleted = 0 AND parent = ? ORDER BY id"), &[Value::from(parent.as_str())])?;
    Ok(rows.iter().map(read).collect::<Result<Vec<_>, _>>()?.into_iter().map(|r| r.gebiet).collect())
}

/// Live Gebiete of one world whose bounding box meets `bbox`: the only ones a new outline can overlap.
pub fn near<S: Sql>(sql: &mut S, art: Art, bbox: [f64; 4]) -> Result<Vec<Gebiet>, SqlError> {
    let rows = sql.query(
        &format!("SELECT {COLUMNS} FROM areas WHERE deleted = 0 AND art = ? AND max_lng >= ? AND min_lng <= ? AND max_lat >= ? AND min_lat <= ? ORDER BY id"),
        &[Value::from(tag(&art)), Value::from(bbox[0]), Value::from(bbox[2]), Value::from(bbox[1]), Value::from(bbox[3])],
    )?;
    Ok(rows.iter().map(read).collect::<Result<Vec<_>, _>>()?.into_iter().map(|r| r.gebiet).collect())
}

/// The world and Gruppe of these Gebiete (also deleted ones): what `decide` is asked about.
pub fn facts<S: Sql>(sql: &mut S, ids: &[GebietId]) -> Result<Vec<Facts>, SqlError> {
    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(super::IN_CHUNK) {
        let rows = sql.query(
            &format!("SELECT id, art, gruppe FROM areas WHERE id IN ({})", super::placeholders(chunk.len())),
            &chunk.iter().map(|id| Value::from(id.as_str())).collect::<Vec<_>>(),
        )?;
        for r in &rows {
            out.push(Facts { id: GebietId::new(r.text(0)?), art: untag(r.text(1)?)?, gruppe: r.opt_text(2)?.map(GruppeId::new) });
        }
    }
    Ok(out)
}

/// The world and Gruppe of every Gebiet that is not deleted, by id.
pub fn live_facts<S: Sql>(sql: &mut S) -> Result<Vec<Facts>, SqlError> {
    let rows = sql.query("SELECT id, art, gruppe FROM areas WHERE deleted = 0 ORDER BY id", &[])?;
    rows.iter().map(|r| Ok(Facts { id: GebietId::new(r.text(0)?), art: untag(r.text(1)?)?, gruppe: r.opt_text(2)?.map(GruppeId::new) })).collect()
}

/// Write the state of a Gebiet if its revision is not older than the stored one; a deleted row stays deleted.
pub fn upsert<S: Sql>(sql: &mut S, g: &Gebiet) -> Result<(), SqlError> {
    let b = bbox(&g.ring);
    sql.execute(
        "INSERT INTO areas (id, art, gruppe, parent, name, ring, rev, deleted, collected_by, collected_at, min_lng, min_lat, max_lng, max_lat)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET gruppe = excluded.gruppe, name = excluded.name, ring = excluded.ring, rev = excluded.rev,
           collected_by = excluded.collected_by, collected_at = excluded.collected_at,
           min_lng = excluded.min_lng, min_lat = excluded.min_lat, max_lng = excluded.max_lng, max_lat = excluded.max_lat
         WHERE excluded.rev >= areas.rev",
        &[
            Value::from(g.id.as_str()),
            Value::from(tag(&g.art)),
            text_or_null(g.gruppe.as_ref().map(GruppeId::as_str)),
            text_or_null(g.parent.as_ref().map(GebietId::as_str)),
            Value::from(g.name.as_str()),
            Value::from(json(&g.ring)),
            Value::from(g.rev),
            text_or_null(g.collected.as_ref().map(|c| c.by.as_str())),
            Value::from(g.collected.as_ref().map(|c| c.at)),
            Value::from(b[0]),
            Value::from(b[1]),
            Value::from(b[2]),
            Value::from(b[3]),
        ],
    )
}

pub fn tombstone<S: Sql>(sql: &mut S, id: &GebietId, rev: u64) -> Result<(), SqlError> {
    sql.execute("UPDATE areas SET deleted = 1, rev = ? WHERE id = ? AND rev <= ?", &[Value::from(rev), Value::from(id.as_str()), Value::from(rev)])
}

/// Taken over (Some) or free (None). The revision stays: taking a Gebiet over is not an edit of it.
pub fn set_collected<S: Sql>(sql: &mut S, id: &GebietId, collected: Option<&Collected>) -> Result<(), SqlError> {
    sql.execute(
        "UPDATE areas SET collected_by = ?, collected_at = ? WHERE id = ?",
        &[text_or_null(collected.map(|c| c.by.as_str())), Value::from(collected.map(|c| c.at)), Value::from(id.as_str())],
    )
}
