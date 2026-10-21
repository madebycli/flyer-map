//! An Abhol-Helfer: a collection session made when the person opened the collection link.
use super::{cookies, hash::hash_secret};
use crate::{
    db::{decode_one, stmt, Db, DbError},
    http::request::Request,
    params,
};
use flyermap_rights::{Caller, Role};
use serde::Deserialize;

#[derive(Deserialize)]
struct Row {
    collector_id: String,
    label: Option<String>,
    expires_at: String,
    session_revoked_at: Option<String>,
    collector_revoked_at: Option<String>,
}

fn is_collection_schema_error(e: &DbError) -> bool {
    let m = e.message.to_ascii_lowercase();
    (m.contains("no such table") && m.contains("collection_")) || (m.contains("collection_") && m.contains("does not exist"))
}

pub async fn resolve<D: Db>(db: &D, request: &Request, campaign_id: Option<&str>, now_iso: &str) -> Result<Option<Caller>, DbError> {
    let Some(secret) = cookies::cookie(request, cookies::COLLECTION_COOKIE).filter(|s| !s.is_empty() && s.encode_utf16().count() <= 256) else {
        return Ok(None);
    };
    let sql = "SELECT s.collector_id, s.campaign_id, c.access_link_id, c.label,
                s.expires_at, s.revoked_at AS session_revoked_at,
                c.revoked_at AS collector_revoked_at
           FROM collection_collector_sessions s
           JOIN collection_collectors c
             ON c.id = s.collector_id AND c.campaign_id = s.campaign_id
           JOIN collection_access_links l
             ON l.id = c.access_link_id AND l.campaign_id = c.campaign_id
          WHERE s.session_hash = ?
            AND (? IS NULL OR s.campaign_id = ?)
          LIMIT 1";
    let row = match db.first(&stmt(sql, params![hash_secret(&secret), campaign_id.map(str::to_string), campaign_id.map(str::to_string)])).await {
        Ok(row) => row,
        Err(e) if is_collection_schema_error(&e) => return Ok(None),
        Err(e) => return Err(e),
    };
    let Some(row) = decode_one::<Row>(row)? else {
        return Ok(None);
    };
    if row.expires_at.as_str() <= now_iso || row.session_revoked_at.is_some() || row.collector_revoked_at.is_some() {
        return Ok(None);
    }
    let mut caller = Caller::new(&format!("collection:{}", row.collector_id), Role::CollectionCollector).as_collector(&row.collector_id);
    caller.label = row.label;
    Ok(Some(caller))
}
