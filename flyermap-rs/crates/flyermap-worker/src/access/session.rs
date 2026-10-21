//! A campaign session: the cookie of someone who opened a Gruppen- or Ansehen-link, a room guest, or an organiser.
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
    grant_id: String,
    role: String,
    team_id: Option<String>,
    label: Option<String>,
    #[serde(default)]
    room_id: Option<String>,
    #[serde(default)]
    room_area_id: Option<String>,
    #[serde(default)]
    room_status: Option<String>,
}

fn query(with_room: bool) -> String {
    let extra = if with_room { ", g.room_id AS room_id, r.area_id AS room_area_id, r.status AS room_status" } else { "" };
    let join = if with_room { "LEFT JOIN v5_rooms r ON r.id = g.room_id AND r.campaign_id = g.campaign_id" } else { "" };
    format!(
        "SELECT g.id AS grant_id, g.campaign_id, g.role, g.team_id, g.label{extra}
       FROM campaign_sessions s
       JOIN campaign_access_grants g
         ON g.id = s.grant_id AND g.campaign_id = s.campaign_id
       {join}
       WHERE s.session_hash = ?
         AND s.expires_at > ?
         AND g.revoked_at IS NULL
         AND (? IS NULL OR g.campaign_id = ?)
       LIMIT 1"
    )
}

/// `allow_room`: a guest of a room is let in only where the room's rules are enforced (the v5 API).
pub async fn resolve_persistent<D: Db>(
    db: &D,
    request: &Request,
    campaign_id: Option<&str>,
    now_iso: &str,
    allow_room: bool,
) -> Result<Option<Caller>, DbError> {
    let Some(secret) = cookies::cookie(request, cookies::SESSION_COOKIE).filter(|s| !s.is_empty() && s.encode_utf16().count() <= 256) else {
        return Ok(None);
    };
    let hash = hash_secret(&secret);
    let params = || params![hash.as_str(), now_iso, campaign_id.map(str::to_string), campaign_id.map(str::to_string)];
    let row = match db.first(&stmt(query(true), params())).await {
        Ok(row) => row,
        // A database without the rooms migration must not lock everybody out.
        Err(e) if e.is_missing_schema() => db.first(&stmt(query(false), params())).await?,
        Err(e) => return Err(e),
    };
    let Some(row) = decode_one::<Row>(row)? else {
        return Ok(None);
    };
    if row.room_id.is_some() && (!allow_room || row.room_status.as_deref() != Some("active")) {
        return Ok(None);
    }
    let Some(role) = Role::parse(&row.role) else {
        return Ok(None);
    };
    let mut caller = Caller::new(&row.grant_id, role);
    caller.team_id = row.team_id;
    caller.label = row.label;
    if row.room_id.is_some() {
        caller.room_id = row.room_id;
        caller.room_area_id = row.room_area_id;
    }
    Ok(Some(caller))
}
