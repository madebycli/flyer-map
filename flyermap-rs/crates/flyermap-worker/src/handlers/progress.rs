//! `PUT /areas/stats` (a device that derived units reports their sizes) and `GET /progress` (per readable Gebiet: reported size and how many
//! houses are done, later, not deliverable). One aggregate each, so the numbers cost the same whatever the size of the city.
use super::{body::int_in, fail, Outcome};
use crate::{
    db::{decode, stmt, Db, Param},
    http::{request::Request, response::Response, router::is_id},
    params, repo,
    time::iso,
};
use flyermap_rights::{Caller, Role};
use flyermap_wire::ErrorCode;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::cell::RefCell;

const MAX_UNITS: usize = 800;
const MAX_COUNT: i64 = 10_000_000;
const TTL_MS: u64 = 30_000;
const CACHE_SIZE: usize = 200;

thread_local! {
    /// Devices ask often and the count reads every done row of the Aktion: the answer is kept for a short while per Worker instance.
    static CACHE: RefCell<Vec<(String, u64, Value)>> = const { RefCell::new(Vec::new()) };
}

/// `<area>` or `<area>~<part>`: `[A-Za-z0-9._:-]{1,160}` with an optional `~` and 1–4 digits.
fn is_unit(text: &str) -> bool {
    let (head, part) = match text.rsplit_once('~') {
        Some((head, part)) => (head, Some(part)),
        None => (text, None),
    };
    is_id(head) && part.is_none_or(|p| (1..=4).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
}

/// A report (or a new pack) changes the sizes: the next read must see them.
pub(crate) fn forget(campaign_id: &str) {
    let prefix = format!("{campaign_id}|");
    CACHE.with(|c| c.borrow_mut().retain(|(key, _, _)| !key.starts_with(&prefix)));
}

struct Unit {
    unit: String,
    area: String,
    version: i64,
    houses: i64,
    segments: i64,
}

fn unit_of(value: &Value) -> Result<Unit, &'static str> {
    let (Some(unit), Some(area)) = (value.get("unit").and_then(Value::as_str), value.get("area").and_then(Value::as_str)) else {
        return Err("Einheit ungültig.");
    };
    if !is_unit(unit) || !is_id(area) {
        return Err("Einheit ungültig.");
    }
    if unit != area && !unit.starts_with(&format!("{area}~")) {
        return Err("Einheit gehört nicht zum Gebiet.");
    }
    let count = |key| int_in(value.get(key), 0, MAX_COUNT);
    match (count("packVersion"), count("houses"), count("segments")) {
        (Some(version), Some(houses), Some(segments)) => Ok(Unit { unit: unit.into(), area: area.into(), version, houses, segments }),
        _ => Err("Zahlen ungültig."),
    }
}

pub async fn put_stats<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request, now: u64) -> Outcome {
    if caller.role != Role::Admin {
        return fail(ErrorCode::Forbidden, "Nur Admins dürfen Gebietsgrößen melden.");
    }
    if !request.header("content-type").unwrap_or("").contains("application/json") {
        return fail(ErrorCode::UnsupportedMediaType, "JSON erwartet.");
    }
    let Ok(body) = serde_json::from_str::<Value>(&request.body_text()) else { return fail(ErrorCode::InvalidJson, "Ungültiges JSON.") };
    let units = body.get("units").and_then(Value::as_array).filter(|u| !u.is_empty() && u.len() <= MAX_UNITS);
    let Some(units) = units else { return fail(ErrorCode::InvalidUnits, &format!("1 bis {MAX_UNITS} Einheiten erwartet.")) };
    let mut rows = Vec::with_capacity(units.len());
    for value in units {
        match unit_of(value) {
            Ok(unit) => rows.push(unit),
            Err(message) => return fail(ErrorCode::InvalidUnits, message),
        }
    }
    let mut areas: Vec<&str> = Vec::new();
    for row in &rows {
        if !areas.contains(&row.area.as_str()) {
            areas.push(&row.area);
        }
    }
    for area in areas {
        if repo::areas::resolve_area(db, campaign_id, area).await?.is_none() {
            return fail(ErrorCode::NotFound, "Gebiet nicht gefunden.");
        }
    }
    let at = iso(now);
    let statements: Vec<_> = rows
        .iter()
        .map(|r| {
            stmt(
                "INSERT INTO v5_area_stats (campaign_id, unit_id, area_id, pack_version, houses, segments, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, unit_id) DO UPDATE SET area_id = excluded.area_id, pack_version = excluded.pack_version, houses = excluded.houses, segments = excluded.segments, reported_at = excluded.reported_at",
                params![campaign_id, r.unit.as_str(), r.area.as_str(), r.version, r.houses, r.segments, at.as_str()],
            )
        })
        .collect();
    db.batch(&statements).await?;
    forget(campaign_id);
    Ok(Response::json(200, &json!({ "ok": true, "units": rows.len() })))
}

#[derive(Deserialize)]
struct Size {
    area_id: String,
    houses: i64,
    segments: i64,
    units: i64,
}

#[derive(Deserialize)]
struct Done {
    area_id: String,
    status: String,
    n: i64,
}

fn param_text(p: &Param) -> String {
    match p {
        Param::Null => String::new(),
        Param::Int(i) => i.to_string(),
        Param::Real(r) => r.to_string(),
        Param::Text(t) => t.clone(),
        Param::Blob(b) => format!("{b:?}"),
    }
}

pub async fn get<D: Db>(db: &D, caller: &Caller, campaign_id: &str, now: u64) -> Outcome {
    let (scope, scope_params) = repo::state::readable_areas(caller, campaign_id);
    let key = format!("{campaign_id}|{scope}|{}", scope_params.iter().map(param_text).collect::<Vec<_>>().join(","));
    let hit = CACHE.with(|c| c.borrow().iter().find(|(k, at, _)| *k == key && now >= *at && now - at < TTL_MS).map(|(_, _, body)| body.clone()));
    if let Some(body) = hit {
        return Ok(Response::json(200, &body));
    }
    let with_scope = |head: Vec<Param>| head.into_iter().chain(scope_params.iter().cloned()).collect::<Vec<_>>();
    let sizes: Vec<Size> = decode(
        db.all(&stmt(
            format!(
                "SELECT s.area_id AS area_id, SUM(s.houses) AS houses, SUM(s.segments) AS segments, COUNT(*) AS units
       FROM v5_area_stats s JOIN v5_pack_meta m ON m.campaign_id = s.campaign_id AND m.area_id = s.area_id AND m.version = s.pack_version
      WHERE s.campaign_id = ?{} GROUP BY s.area_id",
                scope.replace("area_id", "s.area_id")
            ),
            with_scope(params![campaign_id]),
        ))
        .await?,
    )?;
    let done: Vec<Done> = decode(
        db.all(&stmt(
            format!("SELECT area_id, status, COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND key LIKE 'h:%' AND status <> 'open'{scope} GROUP BY area_id, status"),
            with_scope(params![campaign_id]),
        ))
        .await?,
    )?;
    let mut areas = Map::new();
    let empty = || json!({ "houses": 0, "segments": 0, "units": 0, "completed": 0, "later": 0, "notDeliverable": 0 });
    for s in sizes {
        let a = areas.entry(s.area_id).or_insert_with(empty);
        a["houses"] = s.houses.into();
        a["segments"] = s.segments.into();
        a["units"] = s.units.into();
    }
    for d in done {
        let a = areas.entry(d.area_id).or_insert_with(empty);
        match d.status.as_str() {
            "completed" => a["completed"] = d.n.into(),
            "later" => a["later"] = d.n.into(),
            "not-deliverable" => a["notDeliverable"] = d.n.into(),
            _ => {}
        }
    }
    let body = json!({ "areas": areas });
    CACHE.with(|c| {
        let mut cache = c.borrow_mut();
        match cache.iter_mut().find(|(k, _, _)| *k == key) {
            Some(entry) => *entry = (key, now, body.clone()),
            None => cache.push((key, now, body.clone())),
        }
        if cache.len() > CACHE_SIZE {
            cache.remove(0);
        }
    });
    Ok(Response::json(200, &body))
}

#[cfg(test)]
mod tests {
    #[test]
    fn units() {
        for good in ["area_n", "area_n~3", "a.b:c-d~1234"] {
            assert!(super::is_unit(good), "{good}");
        }
        for bad in ["", "area~", "area~12345", "area~x", "a b", "area~1~2"] {
            assert!(!super::is_unit(bad), "{bad}");
        }
    }
}
