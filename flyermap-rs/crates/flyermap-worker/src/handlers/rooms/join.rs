//! Joining a room (public: the person may have no access yet). The room id is unguessable; in `link` mode the secret `j` is a second factor, and a
//! wrong link reveals nothing, not even that the room exists. A guest gets an access of their own (a team-editor grant bound to the room) that ends
//! with the room.
use super::{
    model::{guests, load, RoomRow},
    password,
};
use crate::{
    access::{
        grants::{create_session, session_cookie},
        hash::hash_secret,
        session::resolve_persistent,
    },
    app::Options,
    db::{decode_one, stmt, Db},
    handlers::{body::read_json, fail, Outcome},
    http::{request::Request, response::Response, router::is_id},
    params,
    time::{iso, parse_iso_ms},
};
use flyermap_rights::Role;
use flyermap_wire::{ApiError, ErrorCode};
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_GUESTS: i64 = 300;
const LOCK_AFTER: i64 = 8;
const LOCK_MS: u64 = 10 * 60_000;
const GUEST_SESSION_SECONDS: u64 = 16 * 60 * 60;

#[derive(PartialEq, Eq)]
enum Verdict {
    Ok,
    Finished,
    TeamOnly,
    BadLink,
}

fn may_join(room: &RoomRow, secret: Option<&str>) -> Verdict {
    if room.status != "active" {
        Verdict::Finished
    } else if room.join_mode == "team" {
        Verdict::TeamOnly
    } else if room.join_mode == "link" && !secret.is_some_and(|s| password::safe_equal(s, &room.join_secret)) {
        Verdict::BadLink
    } else {
        Verdict::Ok
    }
}

fn not_found() -> Outcome {
    fail(ErrorCode::NotFound, "Raum nicht gefunden.")
}

async fn load_valid<D: Db>(db: &D, room_id: &str) -> Result<Option<RoomRow>, crate::db::DbError> {
    if is_id(room_id) {
        load(db, room_id).await
    } else {
        Ok(None)
    }
}

/// What the join page may show.
pub async fn info<D: Db>(db: &D, room_id: &str, request: &Request) -> Outcome {
    let Some(room) = load_valid(db, room_id).await? else { return not_found() };
    let verdict = may_join(&room, request.query("j").as_deref());
    if verdict == Verdict::BadLink {
        return not_found();
    }
    #[derive(Deserialize)]
    struct Named {
        name: String,
    }
    let campaign = decode_one::<Named>(db.first(&stmt("SELECT name FROM campaigns WHERE id = ?", params![room.campaign_id.as_str()])).await?)?;
    let ok = verdict == Verdict::Ok;
    let reason = match verdict {
        Verdict::Finished => Some("finished"),
        Verdict::TeamOnly => Some("team_only"),
        _ => None,
    };
    Ok(Response::json(
        200,
        &json!({
            "status": room.status, "areaName": room.area_name, "campaignName": campaign.map(|c| c.name).unwrap_or_default(), "joinMode": room.join_mode,
            "passwordRequired": room.join_mode == "password", "canJoin": ok, "reason": reason, "campaignId": if ok { Some(&room.campaign_id) } else { None },
        }),
    ))
}

/// The guest's name as others see it: no control characters or angle brackets, at most 40 UTF-16 units, "Gast" when empty.
fn clean_label(raw: &str) -> String {
    let kept: String = raw.chars().filter(|c| !matches!(*c, '\u{0}'..='\u{1f}' | '\u{7f}' | '<' | '>')).collect();
    let trimmed = kept.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let mut units = 0;
    let label: String = trimmed
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 40
        })
        .collect();
    if label.is_empty() {
        "Gast".into()
    } else {
        label
    }
}

/// Checks the password and keeps the lock; `Some(answer)` stops the join.
async fn check_password<D: Db>(db: &D, room: &RoomRow, body: &serde_json::Map<String, Value>, now: u64) -> Result<Option<Response>, crate::db::DbError> {
    let locked_until = room.locked_until.as_deref().and_then(parse_iso_ms);
    if locked_until.is_some_and(|t| t > now as i64) {
        return fail(ErrorCode::RoomLocked, ErrorCode::RoomLocked.message()).map(Some);
    }
    let given = body.get("password").and_then(Value::as_str).unwrap_or("");
    let good = match (&room.password_salt, &room.password_hash) {
        (Some(salt), Some(hash)) => (1..=64).contains(&given.encode_utf16().count()) && password::safe_equal(&password::hash(given, salt), hash),
        _ => false,
    };
    if good {
        db.batch(&[stmt("UPDATE v5_rooms SET failed_joins = 0, locked_until = NULL WHERE id = ?", params![room.id.as_str()])]).await?;
        return Ok(None);
    }
    let failed = if locked_until.is_some_and(|t| t <= now as i64) { 0 } else { room.failed_joins } + 1;
    let (count, lock) = if failed >= LOCK_AFTER { (0, Some(iso(now + LOCK_MS))) } else { (failed, None) };
    db.batch(&[stmt("UPDATE v5_rooms SET failed_joins = ?, locked_until = ? WHERE id = ?", params![count, lock, room.id.as_str()])]).await?;
    fail(ErrorCode::WrongPassword, ErrorCode::WrongPassword.message()).map(Some)
}

pub async fn join<D: Db>(db: &D, room_id: &str, request: &Request, options: &Options) -> Outcome {
    let Some(room) = load_valid(db, room_id).await? else { return not_found() };
    let body = match read_json(request, 10_000) {
        Ok(b) => b,
        Err(r) => return Ok(r),
    };
    let now = (options.now)();
    match may_join(&room, body.get("j").and_then(Value::as_str)) {
        Verdict::BadLink => return not_found(),
        Verdict::Finished => {
            // 403 here (the room list answers 409): the TypeScript Worker does the same.
            let mut response = Response::error(&ApiError::new(ErrorCode::RoomFinished));
            response.status = 403;
            return Ok(response);
        }
        Verdict::TeamOnly => return fail(ErrorCode::TeamOnly, ErrorCode::TeamOnly.message()),
        Verdict::Ok => {}
    }
    // Somebody signed in already: an admin or a member of the Gruppe needs no join; a guest of this very room just goes on.
    if let Some(current) = resolve_persistent(db, request, Some(&room.campaign_id), &iso(now), true).await? {
        if current.role == Role::Admin {
            return fail(ErrorCode::AlreadySignedIn, ErrorCode::AlreadySignedIn.message());
        }
        if current.role == Role::TeamEditor && current.room_id.is_none() && current.team_id.as_deref() == Some(&room.team_id) {
            return fail(ErrorCode::AlreadyMember, ErrorCode::AlreadyMember.message());
        }
        if current.room_id.as_deref() == Some(&room.id) {
            return Ok(Response::json(200, &json!({ "campaignId": room.campaign_id, "areaId": room.area_id, "again": true })));
        }
    }
    if room.join_mode == "password" {
        if let Some(stop) = check_password(db, &room, &body, now).await? {
            return Ok(stop);
        }
    }
    if guests(db, &room.id).await? >= MAX_GUESTS {
        return fail(ErrorCode::RoomFull, ErrorCode::RoomFull.message());
    }
    let label = clean_label(body.get("label").and_then(Value::as_str).unwrap_or(""));
    let grant_id = format!("grant_{}", options.uuid());
    let at = iso(now);
    db.batch(&[
        stmt(
            "INSERT INTO campaign_access_grants (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
            params![grant_id.as_str(), room.campaign_id.as_str(), "team-editor", room.team_id.as_str(), hash_secret(&options.secret()), label.as_str(), at.as_str(), room.id.as_str()],
        ),
        stmt("INSERT INTO v5_room_guests (room_id, grant_id, label, joined_at) VALUES (?, ?, ?, ?)", params![room.id.as_str(), grant_id.as_str(), label.as_str(), at.as_str()]),
    ])
    .await?;
    let secret = create_session(db, options, &grant_id, &room.campaign_id, GUEST_SESSION_SECONDS).await?;
    let mut response = Response::json(200, &json!({ "campaignId": room.campaign_id, "areaId": room.area_id }));
    response.set_header("set-cookie", &session_cookie(&secret, GUEST_SESSION_SECONDS));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::clean_label;

    #[test]
    fn labels_are_cleaned_like_the_typescript_worker() {
        assert_eq!(clean_label("  <b>Anna</b>\u{7}  "), "bAnna/b");
        assert_eq!(clean_label("   "), "Gast");
        assert_eq!(clean_label(&"x".repeat(50)).len(), 40);
        assert_eq!(clean_label(&"😀".repeat(30)).chars().count(), 20);
    }
}
