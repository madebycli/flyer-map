//! Building a pack: plan the parts, claim the one-per-minute attempt, ask the map data source (the public mirrors in turn, or the configured
//! one), clean the answer up and store it in chunks.
use super::{
    part_of,
    parts::{self, have},
    readable,
};
use crate::{
    app::Options,
    db::{stmt, Db, Param, Stmt},
    handlers::{fail, progress, Outcome},
    http::{request::Request, response::Response},
    params, repo,
    time::iso,
    upstream::{Failure, Outgoing},
};
use flyermap_pack::{encode, normalize, overpass_query, plan, ENGINE_VERSION, MAX_PACK_PARTS};
use flyermap_rights::{Caller, Role};
use flyermap_wire::{geometry::Polygon, ErrorCode};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};

const CHUNK_BYTES: usize = 512 * 1024;
const COOLDOWN_MS: u64 = 60_000;
const MIRRORS: [&str; 5] = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
];
/// `encodeURIComponent` keeps these.
const COMPONENT: &AsciiSet =
    &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~').remove(b'*').remove(b'\'').remove(b'(').remove(b')');

/// `new URL(url).hostname`: no scheme, no credentials, no port.
fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if host.starts_with('[') {
        return host.split_once(']').map_or(host.to_string(), |(h, _)| format!("{h}]"));
    }
    host.split(':').next().unwrap_or("").to_ascii_lowercase()
}

/// Asks the sources in turn; on a refusal that a mirror would not change (a 4xx other than 429) it stops. `Err` carries what each said.
async fn ask(options: &Options, query: &str) -> Result<String, Vec<String>> {
    let configured = options.overpass_url.as_deref().map(|u| vec![u]);
    let urls = configured.unwrap_or_else(|| MIRRORS.to_vec());
    let mut tried = Vec::new();
    for url in urls {
        let host = host_of(url);
        let out = Outgoing {
            url: url.to_string(),
            headers: vec![
                ("content-type".into(), "application/x-www-form-urlencoded".into()),
                ("user-agent".into(), "verteil-flyer-v5/1 (flyer distribution field tool)".into()),
            ],
            body: format!("data={}", utf8_percent_encode(query, COMPONENT)),
        };
        match (options.fetch)(out).await {
            Ok(answer) if (200..300).contains(&answer.status) => return Ok(answer.body),
            Ok(answer) => {
                tried.push(format!("{host} {}", answer.status));
                if answer.status != 429 && answer.status < 500 {
                    break;
                }
            }
            Err(Failure::Timeout) => tried.push(format!("{host} Zeitüberschreitung")),
            Err(Failure::Unreachable) => tried.push(format!("{host} keine Antwort")),
        }
    }
    Err(tried)
}

fn upstream_failed(tried: &[String]) -> Outcome {
    let all = tried.join(" · ");
    let status = tried.last().and_then(|t| t.rsplit_once(' ')).map(|(_, s)| s).filter(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()));
    match status {
        Some(status) => fail(ErrorCode::OverpassError, &format!("Kartendatenquelle antwortete mit {status}. Bitte später erneut versuchen. ({all})")),
        None => fail(ErrorCode::OverpassUnreachable, &format!("Kartendatenquelle nicht erreichbar. Bitte später erneut versuchen. ({all})")),
    }
}

/// Overpass answers 200 with a `remark` when a query ran out of time or memory and only part of the data came back.
fn incomplete(answer: &Value) -> bool {
    answer.get("remark").and_then(Value::as_str).is_some_and(|r| {
        let r = r.to_lowercase();
        ["runtime error", "timed out", "timeout", "out of memory", "too many"].iter().any(|w| r.contains(w))
    })
}

/// One stored pack version of a Gebiet or part.
struct Stored<'a> {
    campaign_id: &'a str,
    key: &'a str,
    version: i64,
    bytes: &'a [u8],
    stats_json: String,
    built_at: String,
    outline: &'a str,
    /// An older version exists and its chunks go.
    replaces: bool,
}

fn store_statements(s: &Stored) -> Vec<Stmt> {
    let Stored { campaign_id, key, version, bytes, ref stats_json, ref built_at, outline, replaces } = *s;
    let chunks = bytes.len().div_ceil(CHUNK_BYTES);
    let mut batch: Vec<Stmt> = bytes
        .chunks(CHUNK_BYTES)
        .enumerate()
        .map(|(i, chunk)| {
            stmt(
                "INSERT INTO v5_packs (campaign_id, area_id, version, chunk, bytes) VALUES (?, ?, ?, ?, ?)",
                vec![campaign_id.into(), key.into(), version.into(), i.into(), Param::Blob(chunk.to_vec())],
            )
        })
        .collect();
    batch.push(stmt(
        "INSERT INTO v5_pack_meta (campaign_id, area_id, version, chunks, total_bytes, engine, stats_json, built_at, geometry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, area_id) DO UPDATE SET version = excluded.version, chunks = excluded.chunks, total_bytes = excluded.total_bytes, engine = excluded.engine, stats_json = excluded.stats_json, built_at = excluded.built_at, geometry_hash = excluded.geometry_hash",
        params![campaign_id, key, version, chunks, bytes.len(), ENGINE_VERSION, stats_json.as_str(), built_at.as_str(), outline],
    ));
    if replaces {
        batch.push(stmt("DELETE FROM v5_packs WHERE campaign_id = ? AND area_id = ? AND version < ?", params![campaign_id, key, version]));
    }
    batch
}

pub async fn build<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area_id: &str, request: &Request, options: &Options) -> Outcome {
    let Some(area) = readable(db, caller, campaign_id, area_id).await? else { return fail(ErrorCode::NotFound, "Gebiet nicht gefunden.") };
    // A write-class action (it costs an upstream request): admins, the owning Gruppe, or a helper who holds the Gebiet.
    let may_build = caller.role == Role::Admin
        || (matches!(caller.role, Role::TeamEditor | Role::CollectionCollector) && repo::areas::can_write(db, caller, campaign_id, &area).await?);
    if !may_build {
        return fail(ErrorCode::Forbidden, "Nur Admins oder die zuständige Gruppe dürfen das Paket erzeugen.");
    }
    let geometry_json = repo::areas::geometry_json(db, campaign_id, &area).await?.unwrap_or_default();
    let polygon: Polygon = serde_json::from_str(&geometry_json).unwrap_or(Polygon { coordinates: Vec::new() });
    let plan = plan(polygon.outer());
    if plan.too_large {
        return fail(ErrorCode::AreaTooLarge, &format!("Gebiet zu groß (mehr als {MAX_PACK_PARTS} Kartenteile)."));
    }
    // A one-part Gebiet may be asked without `?part=` or with `?part=0`; a big one needs the part.
    let part = match part_of(request) {
        Ok(None) if plan.single => plan.parts.first(),
        Ok(Some(n)) => plan.parts.get(n),
        _ => None,
    };
    let Some(part) = part else {
        return fail(ErrorCode::PartInvalid, &format!("Für dieses Gebiet gibt es {} Teile; Teil ungültig oder fehlt.", plan.parts.len()));
    };
    let key = if plan.single { area_id.to_string() } else { format!("{area_id}~{}", part.index) };
    let outline = repo::areas::outline_hash(&geometry_json);
    let now = (options.now)();
    // A part already there for this outline is not fetched again.
    if !plan.single && have(db, campaign_id, &key).await?.is_some_and(|h| h.geometry_hash == outline) {
        let mut reply = json!({ "part": part.index, "parts": plan.parts.len(), "skipped": true });
        merge(&mut reply, parts::complete(db, campaign_id, area_id, plan.parts.len(), &outline, &iso(now)).await?);
        return Ok(Response::json(200, &reply));
    }
    // One upstream attempt per Gebiet (part) per minute, claimed atomically before the request.
    let claim = stmt(
        "INSERT INTO v5_pack_attempts (campaign_id, area_id, at) VALUES (?, ?, ?)
     ON CONFLICT(campaign_id, area_id) DO UPDATE SET at = excluded.at WHERE v5_pack_attempts.at <= ?",
        params![campaign_id, key.as_str(), now, now.saturating_sub(COOLDOWN_MS)],
    );
    if db.batch(&[claim]).await?.first() != Some(&1) {
        return fail(ErrorCode::PackRecent, ErrorCode::PackRecent.message());
    }
    let text = match ask(options, &overpass_query(&part.bbox)).await {
        Ok(text) => text,
        Err(tried) => return upstream_failed(&tried),
    };
    if text.encode_utf16().count() > options.max_pack_bytes {
        return fail(ErrorCode::OverpassTooLarge, ErrorCode::OverpassTooLarge.message());
    }
    let Ok(answer) = serde_json::from_str::<Value>(&text) else { return fail(ErrorCode::OverpassInvalid, ErrorCode::OverpassInvalid.message()) };
    if incomplete(&answer) {
        return fail(ErrorCode::OverpassIncomplete, ErrorCode::OverpassIncomplete.message());
    }
    let Ok((raw, stats)) = normalize(&answer) else { return fail(ErrorCode::OverpassInvalid, ErrorCode::OverpassInvalid.message()) };
    // A small Gebiet without any street or building is probably a mistake; a part of a big one (water, forest, fields) is simply empty.
    if plan.single && raw.ways.is_empty() && raw.buildings.is_empty() {
        return fail(ErrorCode::PackEmpty, ErrorCode::PackEmpty.message());
    }
    let bytes = encode(&raw);
    let stats_json = serde_json::to_value(&stats).unwrap_or(Value::Null);
    // From here on it is our own work on data that arrived: a failure lifts the one-minute pause so the next try is possible right away.
    let stored: Result<Value, crate::db::DbError> = async {
        let previous = have(db, campaign_id, &key).await?;
        let version = previous.as_ref().map_or(0, |p| p.version) + 1;
        let stored = Stored {
            campaign_id,
            key: &key,
            version,
            bytes: &bytes,
            stats_json: stats_json.to_string(),
            built_at: iso(now),
            outline: &outline,
            replaces: previous.is_some(),
        };
        db.batch(&store_statements(&stored)).await?;
        let chunks = bytes.len().div_ceil(CHUNK_BYTES);
        if plan.single {
            // An outline that used to need parts (and is now small) leaves nothing behind.
            db.batch(&parts::cleanup(campaign_id, area_id, "")).await?;
            progress::forget(campaign_id); // the sizes belong to a pack version
            return Ok(json!({ "version": version, "bytes": bytes.len(), "chunks": chunks, "stats": stats_json }));
        }
        progress::forget(campaign_id);
        let mut reply = json!({ "part": part.index, "parts": plan.parts.len(), "partVersion": version, "bytes": bytes.len(), "stats": stats_json });
        merge(&mut reply, parts::complete(db, campaign_id, area_id, plan.parts.len(), &outline, &iso(now)).await?);
        Ok(reply)
    }
    .await;
    match stored {
        Ok(reply) => Ok(Response::json(200, &reply)),
        Err(e) => {
            let what: String = format!("DbError: {}", e.message).chars().take(160).collect();
            (options.log)(&json!({ "lvl": "error", "msg": "v5 pack build failed after fetch", "error": what }).to_string());
            let _ = db.batch(&[stmt("DELETE FROM v5_pack_attempts WHERE campaign_id = ? AND area_id = ?", params![campaign_id, key.as_str()])]).await;
            fail(ErrorCode::PackFailed, &format!("Kartenpaket konnte nicht erzeugt oder gespeichert werden ({what})."))
        }
    }
}

fn merge(reply: &mut Value, more: Value) {
    if let (Value::Object(r), Value::Object(m)) = (reply, more) {
        r.extend(m);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hosts() {
        assert_eq!(super::host_of("https://overpass-api.de/api/interpreter"), "overpass-api.de");
        assert_eq!(super::host_of("http://127.0.0.1:8799/api/interpreter"), "127.0.0.1");
        assert_eq!(super::host_of("https://u:p@Example.org:8443/x"), "example.org");
    }
}
