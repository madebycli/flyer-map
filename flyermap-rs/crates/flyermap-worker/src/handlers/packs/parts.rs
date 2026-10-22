//! The parts of a big Gebiet: a part belongs to the outline it was built for (its hash); the Gebiet's own row appears once all parts of the
//! current outline are there, so `/meta` reports a big Gebiet as ready exactly when it is.
use crate::{
    db::{decode_one, stmt, Db, DbError, Stmt},
    params,
};
use flyermap_pack::ENGINE_VERSION;
use serde::Deserialize;
use serde_json::{json, Value};

/// Statements that remove every part row of a Gebiet whose outline hash is not `keep` (all of them when `keep` is empty).
pub fn cleanup(campaign_id: &str, area_id: &str, keep: &str) -> Vec<Stmt> {
    let prefix = format!("{area_id}~");
    let len = prefix.encode_utf16().count();
    vec![
        stmt("DELETE FROM v5_pack_meta WHERE campaign_id = ? AND substr(area_id, 1, ?) = ? AND geometry_hash <> ?", params![campaign_id, len, prefix.as_str(), keep]),
        stmt(
            "DELETE FROM v5_packs WHERE campaign_id = ? AND substr(area_id, 1, ?) = ? AND NOT EXISTS (SELECT 1 FROM v5_pack_meta m WHERE m.campaign_id = v5_packs.campaign_id AND m.area_id = v5_packs.area_id)",
            params![campaign_id, len, prefix.as_str()],
        ),
        stmt(
            "DELETE FROM v5_pack_attempts WHERE campaign_id = ? AND substr(area_id, 1, ?) = ? AND NOT EXISTS (SELECT 1 FROM v5_pack_meta m WHERE m.campaign_id = v5_pack_attempts.campaign_id AND m.area_id = v5_pack_attempts.area_id)",
            params![campaign_id, len, prefix.as_str()],
        ),
    ]
}

#[derive(Deserialize)]
pub struct Have {
    pub version: i64,
    pub geometry_hash: String,
}

pub async fn have<D: Db>(db: &D, campaign_id: &str, key: &str) -> Result<Option<Have>, DbError> {
    decode_one(db.first(&stmt("SELECT version, geometry_hash FROM v5_pack_meta WHERE campaign_id = ? AND area_id = ?", params![campaign_id, key])).await?)
}

/// After a part was stored (or found): `{built, complete, version}` for the reply, writing the Gebiet's own row when the last part arrived.
pub async fn complete<D: Db>(db: &D, campaign_id: &str, area_id: &str, parts: usize, outline: &str, built_at: &str) -> Result<Value, DbError> {
    #[derive(Deserialize)]
    struct N {
        n: i64,
    }
    let prefix = format!("{area_id}~");
    let sql = "SELECT COUNT(*) AS n FROM v5_pack_meta WHERE campaign_id = ? AND substr(area_id, 1, ?) = ? AND geometry_hash = ?";
    let built = decode_one::<N>(db.first(&stmt(sql, params![campaign_id, prefix.encode_utf16().count(), prefix.as_str(), outline])).await?)?.map_or(0, |r| r.n);
    if built < parts as i64 {
        return Ok(json!({ "built": built, "complete": false, "version": null }));
    }
    let previous = have(db, campaign_id, area_id).await?;
    if let Some(p) = previous.as_ref().filter(|p| p.geometry_hash == outline) {
        return Ok(json!({ "built": built, "complete": true, "version": p.version }));
    }
    let version = previous.map_or(0, |p| p.version) + 1;
    let mut batch = vec![
        stmt("DELETE FROM v5_packs WHERE campaign_id = ? AND area_id = ?", params![campaign_id, area_id]),
        stmt(
            "INSERT INTO v5_pack_meta (campaign_id, area_id, version, chunks, total_bytes, engine, stats_json, built_at, geometry_hash) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, area_id) DO UPDATE SET version = excluded.version, chunks = 0, total_bytes = 0, engine = excluded.engine, stats_json = excluded.stats_json, built_at = excluded.built_at, geometry_hash = excluded.geometry_hash",
            params![campaign_id, area_id, version, ENGINE_VERSION, json!({ "parts": parts }).to_string(), built_at, outline],
        ),
    ];
    batch.extend(cleanup(campaign_id, area_id, outline));
    db.batch(&batch).await?;
    Ok(json!({ "built": built, "complete": true, "version": version }))
}
