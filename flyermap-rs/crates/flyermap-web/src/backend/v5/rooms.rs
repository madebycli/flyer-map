//! The old server's "Räume" are the Läufe of the new model: `GET /rooms` lists them, the active ones are who is out right now.
use crate::model::Lauf;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Room {
    id: String,
    area_id: String,
    team_id: Option<String>,
    status: String,
    headcount: u32,
    started_at: String,
    houses_done: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct Rooms {
    rooms: Vec<Room>,
}

/// Milliseconds since the epoch of `2027-01-15T08:00:00.000Z` (UTC, as the server writes it); `None` for anything else.
pub fn iso_ms(text: &str) -> Option<u64> {
    let b = text.as_bytes();
    let num = |from: usize, len: usize| text.get(from..from + len)?.parse::<i64>().ok();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, m, d, h, mi, s) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    let millis = if b.get(19) == Some(&b'.') { num(20, 3).unwrap_or(0) } else { 0 };
    // days since 1970-01-01 (Howard Hinnant's civil-from-days, inverted)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 24 + h) * 60 + mi) * 60_000 + s * 1000 + millis).ok()
}

/// The active Läufe of an answer of `GET /rooms`.
pub fn active(json: &str) -> Vec<Lauf> {
    let Ok(parsed) = serde_json::from_str::<Rooms>(json) else { return Vec::new() };
    parsed
        .rooms
        .into_iter()
        .filter(|r| r.status == "active")
        .map(|r| Lauf {
            id: r.id,
            gebiet: r.area_id,
            gruppe: r.team_id,
            headcount: r.headcount,
            members: Vec::new(),
            started_at: iso_ms(&r.started_at),
            houses_done: r.houses_done.and_then(|n| u32::try_from(n).ok()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_servers_time_format_is_read() {
        assert_eq!(iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(iso_ms("2000-03-01T00:00:00.000Z"), Some(951_868_800_000));
        assert_eq!(iso_ms("2027-01-15T08:00:00.500Z"), Some(1_800_000_000_500), "the recorded server clock of the vectors is this day");
        assert_eq!(iso_ms("1800000000000"), None);
        assert_eq!(iso_ms("2027-13-xx"), None);
    }

    #[test]
    fn only_active_rooms_are_out_there() {
        let json = r##"{"rooms":[
            {"id":"r1","areaId":"a1","areaName":"A","teamId":"t1","teamName":"N","teamColor":"#000","status":"active","headcount":3,"startedAt":"2027-01-15T08:00:00.000Z","housesDone":12},
            {"id":"r2","areaId":"a2","areaName":"B","teamId":"t2","teamName":"S","teamColor":"#000","status":"finished","headcount":1,"startedAt":"2027-01-14T08:00:00.000Z","housesDone":null}],"serverNow":1}"##;
        let l = active(json);
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].id.as_str(), l[0].gebiet.as_str(), l[0].headcount, l[0].houses_done), ("r1", "a1", 3, Some(12)));
        assert!(l[0].started_at.is_some());
        assert!(active("nonsense").is_empty());
    }
}
