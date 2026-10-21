use crate::{
    db::{decode_one, stmt, Db, DbError},
    params,
};
use flyermap_rights::{Caller, Role};
use serde::Deserialize;
use serde_json::{json, Value};

pub const MODES: [&str; 4] = ["link", "team", "password", "open"];

#[derive(Clone, Debug, Deserialize)]
pub struct RoomRow {
    pub id: String,
    pub campaign_id: String,
    pub area_id: String,
    pub area_name: String,
    pub team_id: String,
    pub team_name: String,
    pub team_color: String,
    pub status: String,
    pub headcount: i64,
    pub join_mode: String,
    pub join_secret: String,
    pub password_salt: Option<String>,
    pub password_hash: Option<String>,
    pub failed_joins: i64,
    pub locked_until: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub started_by: String,
    pub seq_start: i64,
    pub houses_total: Option<i64>,
    pub houses_done: Option<i64>,
    pub area_done: Option<i64>,
}

/// Who may open rooms: admins and Gruppen (a room guest may not open another one).
pub fn staff(caller: &Caller) -> bool {
    caller.role == Role::Admin || (caller.role == Role::TeamEditor && caller.room_id.is_none())
}

pub fn is_member(caller: &Caller, room: &RoomRow) -> bool {
    caller.role == Role::Admin
        || (caller.role == Role::TeamEditor && caller.team_id.as_deref() == Some(&room.team_id) && caller.room_id.as_ref().is_none_or(|r| *r == room.id))
}

pub async fn load<D: Db>(db: &D, id: &str) -> Result<Option<RoomRow>, DbError> {
    decode_one(db.first(&stmt("SELECT * FROM v5_rooms WHERE id = ?", params![id])).await?)
}

async fn count<D: Db>(db: &D, sql: &str, params: Vec<crate::db::Param>) -> Result<i64, DbError> {
    #[derive(Deserialize)]
    struct N {
        n: i64,
    }
    Ok(decode_one::<N>(db.first(&stmt(sql, params)).await?)?.map_or(0, |r| r.n))
}

/// Houses marked done in the Gebiet since the room opened (the write counter then).
pub async fn done_since<D: Db>(db: &D, room: &RoomRow) -> Result<i64, DbError> {
    count(
        db,
        "SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND seq > ? AND status = 'completed' AND key LIKE 'h:%'",
        params![room.campaign_id.as_str(), room.area_id.as_str(), room.seq_start],
    )
    .await
}

pub async fn area_done<D: Db>(db: &D, room: &RoomRow) -> Result<i64, DbError> {
    count(
        db,
        "SELECT COUNT(*) AS n FROM v5_state WHERE campaign_id = ? AND area_id = ? AND status = 'completed' AND key LIKE 'h:%'",
        params![room.campaign_id.as_str(), room.area_id.as_str()],
    )
    .await
}

pub async fn guests<D: Db>(db: &D, room_id: &str) -> Result<i64, DbError> {
    count(db, "SELECT COUNT(*) AS n FROM v5_room_guests WHERE room_id = ?", params![room_id]).await
}

/// The room as the app shows it; the join secret only for members while the room is open.
pub async fn present<D: Db>(db: &D, room: &RoomRow, with_secret: bool) -> Result<Value, DbError> {
    let active = room.status == "active";
    let mut out = json!({
        "id": room.id, "areaId": room.area_id, "areaName": room.area_name, "teamId": room.team_id, "teamName": room.team_name, "teamColor": room.team_color,
        "status": room.status, "headcount": room.headcount, "joinMode": room.join_mode, "passwordSet": room.password_hash.is_some(), "startedAt": room.started_at,
        "endedAt": room.ended_at, "startedBy": room.started_by, "housesTotal": room.houses_total,
        "housesDone": if active { Some(done_since(db, room).await?) } else { room.houses_done },
        "areaDone": if active { Some(area_done(db, room).await?) } else { room.area_done },
    });
    if with_secret && active {
        out["joinSecret"] = json!(room.join_secret);
    }
    Ok(out)
}
