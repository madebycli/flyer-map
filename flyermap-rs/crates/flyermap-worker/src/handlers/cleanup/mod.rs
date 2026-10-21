//! "Gebiet bereinigen" (`POST /areas/:a/prune`) and "Gebiet vergessen" (`POST /areas/:a/forget`). Admins only: both are bulk changes of shared
//! progress. Rows become tombstones (see [`tombstone`]), never vanish.
mod tombstone;

use super::{fail, Outcome};
use crate::{
    app::Options,
    db::{decode, decode_one, stmt, Db, Param},
    http::{request::Request, response::Response},
    params, repo,
};
use flyermap_rights::{Caller, Role};
use flyermap_wire::ErrorCode;
use serde::Deserialize;
use serde_json::{json, Value};
use tombstone::{gone_guard, statements, tombstone_id, Scope, Table};

const MAX_PRUNE: usize = 5000;
const CONFIRM_MIN: usize = 20;
const CONFIRM_SHARE: f64 = 0.6;
const KEYS_PER_STATEMENT: usize = 1000; // one JSON parameter per statement, ~30 bytes per key

/// `[sh]:` and 1–80 of `[A-Za-z0-9#:._~@-]`.
fn is_key(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("s:").or_else(|| text.strip_prefix("h:")) else { return false };
    (1..=80).contains(&rest.len()) && rest.chars().all(|c| c.is_ascii_alphanumeric() || "#:._~@-".contains(c))
}

fn node(options: &Options) -> String {
    format!("srv{}", &options.uuid()[..6])
}

#[derive(Deserialize)]
struct Found {
    key: String,
    op_id: String,
}

/// After an Area was reshaped the engine derives a different set of keys. The client lists the keys of the Area that no longer exist; exactly
/// those rows (and only rows of this Area) are cleared.
pub async fn prune<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area_id: &str, request: &Request, options: &Options) -> Outcome {
    if caller.role != Role::Admin {
        return fail(ErrorCode::Forbidden, "Nur Admins dürfen ein Gebiet bereinigen.");
    }
    if repo::areas::resolve_area(db, campaign_id, area_id).await?.is_none() {
        return fail(ErrorCode::NotFound, "Gebiet nicht gefunden.");
    }
    if !request.header("content-type").unwrap_or("").contains("application/json") {
        return fail(ErrorCode::UnsupportedMediaType, "JSON erwartet.");
    }
    let text = request.body_text();
    if text.encode_utf16().count() > 200_000 {
        return fail(ErrorCode::TooLarge, "Zu viele Einträge auf einmal.");
    }
    let body = match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(body)) => body,
        Ok(_) => return fail(ErrorCode::InvalidJson, "JSON-Objekt erwartet."),
        Err(_) => return fail(ErrorCode::InvalidJson, "Ungültiges JSON."),
    };
    let listed =
        body.get("keys").and_then(Value::as_array).filter(|k| !k.is_empty() && k.len() <= MAX_PRUNE && k.iter().all(|k| k.as_str().is_some_and(is_key)));
    let Some(listed) = listed else { return fail(ErrorCode::InvalidKeys, &format!("1 bis {MAX_PRUNE} gültige Schlüssel erwartet.")) };
    let mut keys: Vec<&str> = Vec::new();
    for key in listed.iter().filter_map(Value::as_str) {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    // Only rows that really belong to this Area and still carry a status are candidates; the reply names the ones really cleared.
    let mut found: Vec<Found> = Vec::new();
    for chunk in keys.chunks(KEYS_PER_STATEMENT) {
        let sql = "SELECT key, op_id FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open' AND key IN (SELECT value FROM json_each(?))";
        found.extend(decode::<Found>(db.all(&stmt(sql, params![campaign_id, area_id, json!(chunk).to_string()])).await?)?);
    }
    #[derive(Deserialize)]
    struct N {
        n: i64,
    }
    let total = decode_one::<N>(
        db.first(&stmt("SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open'", params![campaign_id, area_id])).await?,
    )?
    .map_or(0, |r| r.n);
    // A clean-up that would wipe most of an Area is almost never intended (a partial map download, a wrong outline): it needs a confirmation.
    if body.get("confirm") != Some(&Value::Bool(true)) && found.len() > CONFIRM_MIN && found.len() as f64 > total as f64 * CONFIRM_SHARE {
        let message = format!("Das würde {} von {total} Markierungen dieses Gebiets entfernen. Bitte bestätigen.", found.len());
        let error = json!({ "code": ErrorCode::PruneConfirmRequired.as_str(), "message": message });
        return Ok(Response::json(409, &json!({ "error": error, "matched": found.len(), "total": total })));
    }
    if found.is_empty() {
        return Ok(Response::json(200, &json!({ "removed": 0, "keys": [] })));
    }
    let newest = found.iter().map(|f| f.op_id.as_str()).max().filter(|m| !m.is_empty());
    let id = tombstone_id((options.now)(), newest, node(options));
    let pair_chunks: Vec<String> =
        found.chunks(KEYS_PER_STATEMENT).map(|c| json!(c.iter().map(|f| json!({ "k": f.key, "o": f.op_id })).collect::<Vec<_>>()).to_string()).collect();
    // Each row is cleared only while it still carries the exact op_id that was looked up: an edit that arrived since is a newer truth and stays.
    let mut batch = Vec::new();
    for pairs in &pair_chunks {
        let scope = Scope {
            where_sql: "campaign_id = ? AND area_id = ? AND status <> 'open' AND (key, op_id) IN (SELECT json_extract(value, '$.k'), json_extract(value, '$.o') FROM json_each(?))".into(),
            params: params![campaign_id, area_id, pairs.as_str()],
        };
        batch.extend(statements(Table::State, campaign_id, &scope, &id, &caller.grant_id));
    }
    db.batch(&batch).await?; // one batch keeps sequence allocation and update atomic
    #[derive(Deserialize)]
    struct K {
        key: String,
    }
    let mut cleared = Vec::new();
    for pairs in &pair_chunks {
        let sql =
            "SELECT key FROM v5_state WHERE campaign_id = ? AND area_id = ? AND op_id = ? AND key IN (SELECT json_extract(value, '$.k') FROM json_each(?))";
        cleared.extend(decode::<K>(db.all(&stmt(sql, params![campaign_id, area_id, id.as_str(), pairs.as_str()])).await?)?.into_iter().map(|r| r.key));
    }
    Ok(Response::json(200, &json!({ "removed": cleared.len(), "keys": cleared })))
}

async fn newest<D: Db>(db: &D, sql: &str, campaign_id: &str, area_id: &str) -> Result<Option<String>, crate::db::DbError> {
    #[derive(Deserialize)]
    struct M {
        m: Option<String>,
    }
    Ok(decode_one::<M>(db.first(&stmt(sql, params![campaign_id, area_id])).await?)?.and_then(|r| r.m))
}

/// After a Gebiet was deleted: everything v5 kept for it goes too. Only once the Gebiet is really gone (checked again inside the batch), so this
/// can never wipe a live Gebiet. Progress and notes become tombstones the other devices pull; the map data is deleted for good.
pub async fn forget<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area_id: &str, options: &Options) -> Outcome {
    if caller.role != Role::Admin {
        return fail(ErrorCode::Forbidden, "Nur Admins dürfen ein Gebiet endgültig entfernen.");
    }
    if repo::areas::resolve_area(db, campaign_id, area_id).await?.is_some() {
        return fail(ErrorCode::AreaStillExists, ErrorCode::AreaStillExists.message());
    }
    let now = (options.now)();
    let guard = gone_guard(db, campaign_id, area_id).await;
    let newest_state =
        newest(db, "SELECT MAX(op_id) AS m FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status <> 'open'", campaign_id, area_id).await?;
    let newest_note = newest(db, "SELECT MAX(rev) AS m FROM v5_notes WHERE campaign_id = ? AND area_id = ? AND deleted = 0", campaign_id, area_id).await?;
    let mut batch = Vec::new();
    let at = |table, newest: &str, column: &str, live: &str, batch: &mut Vec<_>| {
        let mut params: Vec<Param> = params![campaign_id, area_id, newest];
        params.extend(guard.params.iter().cloned());
        let scope = Scope { where_sql: format!("campaign_id = ? AND area_id = ? AND {live} AND {column} <= ?{}", guard.where_sql), params };
        let index = batch.len() + 2;
        batch.extend(statements(table, campaign_id, &scope, &tombstone_id(now, Some(newest), node(options)), &caller.grant_id));
        index
    };
    let state_at = newest_state.as_deref().map(|n| at(Table::State, n, "op_id", "status <> 'open'", &mut batch));
    let notes_at = newest_note.as_deref().map(|n| at(Table::Notes, n, "rev", "deleted = 0", &mut batch));
    for table in ["v5_packs", "v5_pack_meta", "v5_pack_attempts"] {
        // the Area's own rows and, for a big Gebiet, its parts (`<id>~<n>`)
        let mut params: Vec<Param> = params![campaign_id, area_id, area_id.encode_utf16().count() + 1, format!("{area_id}~")];
        params.extend(guard.params.iter().cloned());
        batch.push(stmt(format!("DELETE FROM {table} WHERE campaign_id = ? AND (area_id = ? OR substr(area_id, 1, ?) = ?){}", guard.where_sql), params));
    }
    let changes = db.batch(&batch).await?;
    let changed = |index: Option<usize>| index.and_then(|i| changes.get(i).copied()).unwrap_or(0);
    Ok(Response::json(200, &json!({ "removed": changed(state_at), "notes": changed(notes_at) })))
}

#[cfg(test)]
mod tests {
    #[test]
    fn keys() {
        assert!(super::is_key("h:abc#1") && super::is_key("s:x~2@y"));
        assert!(!super::is_key("x:a") && !super::is_key("h:") && !super::is_key("h:a b") && !super::is_key(&format!("h:{}", "a".repeat(81))));
    }
}
