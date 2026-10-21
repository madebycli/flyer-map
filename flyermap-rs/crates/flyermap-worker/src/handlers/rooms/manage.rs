//! Opening, changing, finishing and deleting rooms; the list of rooms of an Aktion.
use super::{
    model::{area_done, done_since, is_member, load, present, staff, RoomRow, MODES},
    password,
};
use crate::{
    app::Options,
    db::{decode, decode_one, stmt, Db, Param},
    handlers::{
        body::{int_in, read_json},
        fail, Outcome,
    },
    http::{request::Request, response::Response, router::is_id},
    params, repo,
    time::iso,
};
use flyermap_rights::{AreaRef, Caller, Role};
use flyermap_wire::ErrorCode;
use serde::Deserialize;
use serde_json::{json, Value};

fn not_found() -> Outcome {
    fail(ErrorCode::NotFound, "Raum nicht gefunden.")
}

pub async fn list<D: Db>(db: &D, caller: &Caller, campaign_id: &str, now: u64) -> Outcome {
    if caller.role == Role::CollectionCollector {
        return fail(ErrorCode::Forbidden, "Für Helfer gibt es keine Räume.");
    }
    let rows: Vec<RoomRow> =
        decode(db.all(&stmt("SELECT * FROM v5_rooms WHERE campaign_id = ? ORDER BY started_at DESC, id DESC LIMIT 1000", params![campaign_id])).await?)?;
    let mut rooms = Vec::new();
    for room in rows.iter().filter(|r| {
        matches!(caller.role, Role::Admin | Role::Viewer)
            || (caller.role == Role::TeamEditor && caller.team_id.as_deref() == Some(&r.team_id) && caller.room_id.as_ref().is_none_or(|id| *id == r.id))
    }) {
        rooms.push(present(db, room, is_member(caller, room)).await?);
    }
    Ok(Response::json(200, &json!({ "rooms": rooms, "serverNow": now })))
}

fn label_of(caller: &Caller) -> String {
    caller.label.clone().unwrap_or_else(|| caller.grant_id.clone()).chars().take(80).collect()
}

pub async fn create<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request, options: &Options) -> Outcome {
    if !staff(caller) {
        return fail(ErrorCode::Forbidden, "Nur Admins und Gruppen dürfen einen Raum öffnen.");
    }
    let body = match read_json(request, 10_000) {
        Ok(b) => b,
        Err(r) => return Ok(r),
    };
    let Some(headcount) = int_in(body.get("headcount"), 1, 1000) else { return fail(ErrorCode::HeadcountRequired, ErrorCode::HeadcountRequired.message()) };
    let mode = match body.get("joinMode") {
        None => "link",
        Some(Value::String(m)) if MODES.contains(&m.as_str()) => MODES.iter().find(|x| **x == m.as_str()).copied().unwrap_or("link"),
        Some(_) => return fail(ErrorCode::InvalidMode, ErrorCode::InvalidMode.message()),
    };
    let password = if mode == "password" {
        match body.get("password").and_then(Value::as_str) {
            Some(p) if (4..=64).contains(&p.encode_utf16().count()) => Some(p.to_string()),
            _ => return fail(ErrorCode::PasswordRequired, ErrorCode::PasswordRequired.message()),
        }
    } else {
        None
    };
    let houses_total = match body.get("housesTotal") {
        None | Some(Value::Null) => None,
        v => match int_in(v, 0, 10_000_000) {
            Some(n) => Some(n),
            None => return fail(ErrorCode::InvalidTotal, ErrorCode::InvalidTotal.message()),
        },
    };
    let area_id = body.get("areaId").and_then(Value::as_str).filter(|a| is_id(a)).unwrap_or("");
    let area = if area_id.is_empty() { None } else { repo::areas::resolve_area(db, campaign_id, area_id).await? };
    let writable = match &area {
        Some(a @ AreaRef::Distribution { .. }) => repo::areas::can_write(db, caller, campaign_id, a).await?,
        _ => false,
    };
    let Some(AreaRef::Distribution { id: area_id, team_id }) = area.filter(|_| writable) else {
        return fail(ErrorCode::AreaForbidden, "In diesem Gebiet darfst du keinen Raum öffnen.");
    };
    #[derive(Deserialize)]
    struct Team {
        name: String,
        color: String,
    }
    #[derive(Deserialize)]
    struct Named {
        name: String,
    }
    #[derive(Deserialize)]
    struct Seq {
        seq: i64,
    }
    let Some(team) =
        decode_one::<Team>(db.first(&stmt("SELECT name, color FROM teams WHERE id = ? AND campaign_id = ?", params![team_id.as_str(), campaign_id])).await?)?
    else {
        return fail(ErrorCode::TeamMissing, ErrorCode::TeamMissing.message());
    };
    let area_name =
        decode_one::<Named>(db.first(&stmt("SELECT name FROM areas WHERE campaign_id = ? AND id = ?", params![campaign_id, area_id.as_str()])).await?)?
            .map(|n| n.name)
            .unwrap_or_default();
    let counter = decode_one::<Seq>(db.first(&stmt("SELECT seq FROM v5_counters WHERE campaign_id = ?", params![campaign_id])).await?)?.map_or(0, |c| c.seq);
    let id = format!("room_{}", options.uuid());
    let salt: Option<String> = password.as_ref().map(|_| options.secret().chars().take(22).collect());
    let hash = match (&password, &salt) {
        (Some(p), Some(s)) => Some(password::hash(p, s)),
        _ => None,
    };
    let insert = stmt(
        "INSERT INTO v5_rooms (id, campaign_id, area_id, area_name, team_id, team_name, team_color, status, headcount, join_mode, join_secret, password_salt, password_hash, started_at, started_by, seq_start, houses_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id.as_str(),
            campaign_id,
            area_id.as_str(),
            area_name.chars().take(160).collect::<String>(),
            team_id.as_str(),
            team.name.chars().take(160).collect::<String>(),
            team.color.as_str(),
            headcount,
            mode,
            options.secret(),
            salt,
            hash,
            iso((options.now)()),
            label_of(caller),
            counter,
            houses_total
        ],
    );
    if let Err(e) = db.batch(&[insert]).await {
        if e.message.to_ascii_lowercase().contains("unique") {
            return fail(ErrorCode::RoomActive, ErrorCode::RoomActive.message());
        }
        return Err(e);
    }
    let room = load(db, &id).await?.expect("the room just written");
    Ok(Response::json(201, &json!({ "room": present(db, &room, true).await? })))
}

pub async fn update<D: Db>(db: &D, caller: &Caller, campaign_id: &str, room_id: &str, request: &Request, options: &Options) -> Outcome {
    let Some(room) = load(db, room_id).await?.filter(|r| r.campaign_id == campaign_id && is_member(caller, r)) else { return not_found() };
    if room.status != "active" {
        return fail(ErrorCode::RoomFinished, "Der Raum ist beendet.");
    }
    let body = match read_json(request, 10_000) {
        Ok(b) => b,
        Err(r) => return Ok(r),
    };
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<Param> = Vec::new();
    if body.contains_key("headcount") {
        let Some(n) = int_in(body.get("headcount"), 1, 1000) else { return fail(ErrorCode::HeadcountRequired, ErrorCode::HeadcountRequired.message()) };
        sets.push("headcount = ?");
        values.push(n.into());
    }
    if body.get("housesTotal").is_some_and(|v| !v.is_null()) {
        let Some(n) = int_in(body.get("housesTotal"), 0, 10_000_000) else { return fail(ErrorCode::InvalidTotal, ErrorCode::InvalidTotal.message()) };
        sets.push("houses_total = ?");
        values.push(n.into());
    }
    if body.contains_key("joinMode") || body.contains_key("password") {
        if !staff(caller) {
            return fail(ErrorCode::Forbidden, "Die Beitrittsart ändern nur Admins und die Gruppe.");
        }
        let mode = match body.get("joinMode") {
            None => Some(room.join_mode.clone()),
            Some(Value::String(m)) if MODES.contains(&m.as_str()) => Some(m.clone()),
            Some(_) => None,
        };
        let Some(mode) = mode else { return fail(ErrorCode::InvalidMode, ErrorCode::InvalidMode.message()) };
        if mode == "password" {
            let password = body.get("password").and_then(Value::as_str);
            if password.is_none() && room.password_hash.is_none() {
                return fail(ErrorCode::PasswordRequired, ErrorCode::PasswordRequired.message());
            }
            if let Some(p) = password {
                if !(4..=64).contains(&p.encode_utf16().count()) {
                    return fail(ErrorCode::PasswordRequired, ErrorCode::PasswordRequired.message());
                }
                let salt: String = options.secret().chars().take(22).collect();
                sets.extend(["password_salt = ?", "password_hash = ?", "failed_joins = 0", "locked_until = NULL"]);
                values.push(Param::Text(salt.clone()));
                values.push(Param::Text(password::hash(p, &salt)));
            }
        }
        sets.push("join_mode = ?");
        values.push(Param::Text(mode));
    }
    if sets.is_empty() {
        return fail(ErrorCode::NothingToChange, ErrorCode::NothingToChange.message());
    }
    values.push(room_id.into());
    db.batch(&[stmt(format!("UPDATE v5_rooms SET {} WHERE id = ?", sets.join(", ")), values)]).await?;
    let room = load(db, room_id).await?.expect("the room just changed");
    Ok(Response::json(200, &json!({ "room": present(db, &room, true).await? })))
}

/// Every guest access of a room ends with the room.
async fn end_guests<D: Db>(db: &D, room_id: &str, at: &str) -> Result<(), crate::db::DbError> {
    db.batch(&[stmt("UPDATE campaign_access_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE room_id = ?", params![at, room_id])]).await.map(|_| ())
}

pub async fn finish<D: Db>(db: &D, caller: &Caller, campaign_id: &str, room_id: &str, request: &Request, now: u64) -> Outcome {
    let Some(room) = load(db, room_id).await?.filter(|r| r.campaign_id == campaign_id && is_member(caller, r) && staff(caller)) else { return not_found() };
    if room.status != "active" {
        return fail(ErrorCode::RoomFinished, "Der Raum ist schon beendet.");
    }
    let body = if request.header("content-type").unwrap_or("").contains("application/json") {
        match read_json(request, 10_000) {
            Ok(b) => b,
            Err(r) => return Ok(r),
        }
    } else {
        Default::default()
    };
    let total = match body.get("housesTotal") {
        None | Some(Value::Null) => room.houses_total,
        v => match int_in(v, 0, 10_000_000) {
            Some(n) => Some(n),
            None => return fail(ErrorCode::InvalidTotal, ErrorCode::InvalidTotal.message()),
        },
    };
    let ended = iso(now);
    let (done, whole) = (done_since(db, &room).await?, area_done(db, &room).await?);
    db.batch(&[stmt(
        "UPDATE v5_rooms SET status = 'finished', ended_at = ?, houses_done = ?, area_done = ?, houses_total = ? WHERE id = ? AND status = 'active'",
        params![ended.as_str(), done, whole, total, room_id],
    )])
    .await?;
    end_guests(db, room_id, &ended).await?;
    let room = load(db, room_id).await?.expect("the room just finished");
    Ok(Response::json(200, &json!({ "room": present(db, &room, false).await? })))
}

pub async fn delete<D: Db>(db: &D, caller: &Caller, campaign_id: &str, room_id: &str, now: u64) -> Outcome {
    if caller.role != Role::Admin {
        return fail(ErrorCode::Forbidden, "Nur Admins löschen Räume.");
    }
    if load(db, room_id).await?.filter(|r| r.campaign_id == campaign_id).is_none() {
        return not_found();
    }
    end_guests(db, room_id, &iso(now)).await?;
    db.batch(&[stmt("DELETE FROM v5_rooms WHERE id = ?", params![room_id])]).await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}
