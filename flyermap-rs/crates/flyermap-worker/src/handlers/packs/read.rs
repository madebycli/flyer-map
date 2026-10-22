//! Handing a stored pack out. Revalidation is free: an unchanged pack never touches the chunk rows.
use super::{part_of, readable, CACHE_CONTROL};
use crate::{
    db::{decode, decode_one, stmt, Db, DbError},
    handlers::{fail, Outcome},
    http::{request::Request, response::Response},
    params,
};
use flyermap_rights::Caller;
use flyermap_wire::ErrorCode;
use serde::Deserialize;

#[derive(Deserialize)]
struct Meta {
    version: i64,
    chunks: i64,
    total_bytes: i64,
    engine: String,
}

#[derive(Deserialize)]
struct Chunk {
    bytes: Vec<u8>,
}

async fn meta<D: Db>(db: &D, campaign_id: &str, key: &str) -> Result<Option<Meta>, DbError> {
    decode_one(
        db.first(&stmt("SELECT version, chunks, total_bytes, engine FROM v5_pack_meta WHERE campaign_id = ? AND area_id = ?", params![campaign_id, key]))
            .await?,
    )
}

async fn chunks<D: Db>(db: &D, campaign_id: &str, key: &str, version: i64) -> Result<Vec<Chunk>, DbError> {
    let sql = "SELECT chunk, bytes FROM v5_packs WHERE campaign_id = ? AND area_id = ? AND version = ? ORDER BY chunk ASC";
    decode(db.all(&stmt(sql, params![campaign_id, key, version])).await?)
}

pub async fn get<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area_id: &str, request: &Request) -> Outcome {
    if readable(db, caller, campaign_id, area_id).await?.is_none() {
        return fail(ErrorCode::NotFound, "Gebiet nicht gefunden.");
    }
    let Ok(part) = part_of(request) else { return fail(ErrorCode::PartInvalid, ErrorCode::PartInvalid.message()) };
    let key = part.map_or_else(|| area_id.to_string(), |p| format!("{area_id}~{p}"));
    // A big Gebiet's own row has no chunks (only its parts do): asking for it without `?part=` finds nothing.
    let Some(mut found) = meta(db, campaign_id, &key).await?.filter(|m| m.chunks != 0) else {
        return fail(ErrorCode::NoPack, ErrorCode::NoPack.message());
    };
    let etag = format!("\"v5-{}\"", found.version);
    if request.header("if-none-match") == Some(etag.as_str()) {
        return Ok(Response { status: 304, headers: vec![("etag".into(), etag), ("cache-control".into(), CACHE_CONTROL.into())], body: Vec::new() });
    }
    let mut rows = chunks(db, campaign_id, &key, found.version).await?;
    if rows.len() as i64 != found.chunks {
        // A rebuild may have swapped versions between the two reads: look once more before failing.
        if let Some(again) = meta(db, campaign_id, &key).await? {
            found = again;
        }
        rows = chunks(db, campaign_id, &key, found.version).await?;
    }
    if rows.len() as i64 != found.chunks {
        return fail(ErrorCode::PackIncomplete, ErrorCode::PackIncomplete.message());
    }
    let body: Vec<u8> = rows.into_iter().flat_map(|c| c.bytes).collect();
    if body.len() as i64 != found.total_bytes {
        return fail(ErrorCode::PackCorrupt, ErrorCode::PackCorrupt.message());
    }
    let etag = format!("\"v5-{}\"", found.version);
    Ok(Response {
        status: 200,
        headers: vec![
            ("content-type".into(), "application/gzip".into()),
            ("cache-control".into(), CACHE_CONTROL.into()),
            ("etag".into(), etag),
            ("x-pack-version".into(), found.version.to_string()),
            ("x-engine".into(), found.engine),
        ],
        body,
    })
}
