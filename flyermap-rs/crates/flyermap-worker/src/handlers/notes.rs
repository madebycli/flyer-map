//! `GET/POST /campaigns/:id/notes`: notes ride the same rules as status edits (Gebiet rights, key ownership, last writer wins by `rev`), plus one
//! of their own: a note never moves (its key and Gebiet are fixed at creation).
use super::{fail, Outcome};
use crate::{
    db::{decode, decode_one, stmt, Db, Param},
    http::{jsnum::trunc_or, request::Request, response::Response, router::is_id},
    params, repo,
};
use flyermap_core::note::Flag;
use flyermap_rights::{
    is_scoped,
    note_rules::{screen_notes, FlagField, NoteReason, RawNote, TextField, MAX_NOTES},
    writes_allowed, Caller,
};
use flyermap_wire::ErrorCode;
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_BODY: usize = 256_000; // 50 notes × 500 chars, worst case fully JSON-escaped

#[derive(Deserialize)]
struct Row {
    id: String,
    key: String,
    area_id: String,
    flag: Option<String>,
    body: String,
    rev: String,
    deleted: i64,
    actor: String,
    seq: i64,
}

pub async fn pull<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request, now: u64) -> Outcome {
    let since = trunc_or(request.query("since").as_deref(), "0", 0.0).max(0.0) as i64;
    let limit = trunc_or(request.query("limit").as_deref(), "500", 500.0).clamp(1.0, 500.0) as i64;
    let (scope, scope_params) = repo::state::readable_areas(caller, campaign_id);
    let mut p = params![campaign_id, since];
    p.extend(scope_params);
    p.push((limit + 1).into());
    let rows: Vec<Row> = decode(
        db.all(&stmt(
            format!(
                "SELECT id, key, area_id, flag, body, rev, deleted, actor, seq FROM v5_notes WHERE campaign_id = ? AND seq > ?{scope} ORDER BY seq ASC LIMIT ?"
            ),
            p,
        ))
        .await?,
    )?;
    let more = rows.len() as i64 > limit;
    let page = &rows[..rows.len().min(limit as usize)];
    Ok(Response::json(
        200,
        &json!({
            "notes": page.iter().map(|r| json!({"id": r.id, "key": r.key, "area": r.area_id, "flag": r.flag, "text": r.body, "rev": r.rev, "deleted": r.deleted == 1, "by": r.actor})).collect::<Vec<_>>(),
            "cursor": page.last().map_or(since, |r| r.seq),
            "more": more,
            "serverNow": now,
        }),
    ))
}

fn raw_note(v: &Value) -> RawNote {
    let Some(o) = v.as_object() else { return RawNote::NotAnObject };
    let text = |k: &str| o.get(k).and_then(Value::as_str).map(str::to_string);
    let flag = match o.get("flag") {
        None | Some(Value::Null) => FlagField::None,
        Some(Value::String(s)) => Flag::parse(s).map_or(FlagField::Invalid, FlagField::Known),
        Some(_) => FlagField::Invalid,
    };
    let body = match o.get("text") {
        None => TextField::Absent,
        Some(Value::String(s)) => TextField::Text(s.clone()),
        Some(_) => TextField::NotText,
    };
    RawNote::Fields {
        id: text("id"),
        key: text("key"),
        area: text("area"),
        flag,
        text: body,
        rev: text("rev"),
        deleted: o.get("deleted") == Some(&Value::Bool(true)),
    }
}

pub async fn push<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request, now: u64) -> Outcome {
    if !writes_allowed(caller) {
        return fail(ErrorCode::ReadOnly, "Diese Rolle darf keine Notizen schreiben.");
    }
    if !request.header("content-type").unwrap_or("").contains("application/json") {
        return fail(ErrorCode::UnsupportedMediaType, "JSON erwartet.");
    }
    let text = request.body_text();
    if text.encode_utf16().count() > MAX_BODY {
        return fail(ErrorCode::TooLarge, "Zu viele Notizen auf einmal.");
    }
    let Ok(body) = serde_json::from_str::<Value>(&text) else { return fail(ErrorCode::InvalidJson, "Ungültiges JSON.") };
    let Some(body) = body.as_object() else { return fail(ErrorCode::InvalidJson, "JSON-Objekt erwartet.") };
    let notes = match body.get("notes").and_then(Value::as_array) {
        Some(n) if !n.is_empty() && n.len() <= MAX_NOTES => n,
        _ => return fail(ErrorCode::InvalidNotes, &format!("1 bis {MAX_NOTES} Notizen erwartet.")),
    };
    let raw: Vec<RawNote> = notes.iter().map(raw_note).collect();
    let mut writable = std::collections::HashMap::new();
    for note in &raw {
        if let RawNote::Fields { area: Some(area), .. } = note {
            if is_id(area) && !writable.contains_key(area) {
                let ok = match repo::areas::resolve_area(db, campaign_id, area).await? {
                    Some(a) => repo::areas::can_write(db, caller, campaign_id, &a).await?,
                    None => false,
                };
                writable.insert(area.clone(), ok);
            }
        }
    }
    let mut screened = screen_notes(&raw, now, |area| writable.get(area).copied().unwrap_or(false));
    if !screened.latest.is_empty() && is_scoped(caller) {
        // Like status edits: a scoped writer cannot hang notes on a street or house another Gebiet already owns (s:<group> covers its chunks).
        let candidates: Vec<(String, String, String)> =
            screened.latest.values().filter(|n| !n.key.starts_with("a:")).map(|n| (n.id.clone(), n.key.clone(), n.area.clone())).collect();
        for (id, key, area) in candidates {
            #[derive(Deserialize)]
            struct Owner {
                area_id: String,
            }
            let sql = "SELECT area_id FROM v5_state WHERE campaign_id = ? AND (key = ? OR (key >= ? AND key < ?)) LIMIT 1";
            let owner = decode_one::<Owner>(db.first(&stmt(sql, params![campaign_id, key.as_str(), format!("{key}~"), format!("{key}~\u{ffff}")])).await?)?;
            if owner.is_some_and(|o| o.area_id != area) {
                screened.refuse(&id, NoteReason::KeyOwnedElsewhere);
            }
        }
    }
    if !screened.latest.is_empty() {
        // A note never moves: a scoped writer cannot pull a foreign note into their Gebiet.
        let ids: Vec<String> = screened.latest.keys().cloned().collect();
        #[derive(Deserialize)]
        struct Existing {
            id: String,
            key: String,
            area_id: String,
        }
        for chunk in ids.chunks(90) {
            let marks = vec!["?"; chunk.len()].join(",");
            let mut p = params![campaign_id];
            p.extend(chunk.iter().map(Param::from));
            let found: Vec<Existing> =
                decode(db.all(&stmt(format!("SELECT id, key, area_id FROM v5_notes WHERE campaign_id = ? AND id IN ({marks})"), p)).await?)?;
            for row in found {
                let moved = screened.latest.get(&row.id).is_some_and(|n| n.key != row.key || n.area != row.area_id);
                if moved {
                    screened.refuse(&row.id, NoteReason::NoteImmutable);
                }
            }
        }
    }
    if !screened.latest.is_empty() {
        let rows = screened.writes_in_order();
        let actor: String = caller.label.clone().unwrap_or_else(|| caller.grant_id.clone()).chars().take(80).collect();
        let mut statements = vec![
            stmt("INSERT OR IGNORE INTO v5_note_counters (campaign_id, seq) VALUES (?, 0)", params![campaign_id]),
            stmt("UPDATE v5_note_counters SET seq = seq + ? WHERE campaign_id = ?", params![rows.len(), campaign_id]),
        ];
        for (i, r) in rows.iter().enumerate() {
            statements.push(stmt(
                "INSERT INTO v5_notes (campaign_id, id, key, area_id, flag, body, rev, deleted, actor, grant_id, seq)
       VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT seq FROM v5_note_counters WHERE campaign_id = ?) - ?)
       ON CONFLICT(campaign_id, id) DO UPDATE SET flag = excluded.flag, body = excluded.body, rev = excluded.rev, deleted = excluded.deleted, seq = excluded.seq
       WHERE excluded.rev > v5_notes.rev AND v5_notes.key = excluded.key AND v5_notes.area_id = excluded.area_id",
                params![
                    campaign_id,
                    r.id.as_str(),
                    r.key.as_str(),
                    r.area.as_str(),
                    r.flag.map(|f| f.as_str().to_string()),
                    r.text.as_str(),
                    r.rev.as_str(),
                    i64::from(r.deleted),
                    actor.as_str(),
                    caller.grant_id.as_str(),
                    campaign_id,
                    rows.len() - (i + 1)
                ],
            ));
        }
        if db.batch(&statements).await.is_err() {
            return fail(ErrorCode::WriteFailed, "Notizen konnten nicht gespeichert werden.");
        }
    }
    Ok(Response::json(
        200,
        &json!({ "accepted": screened.accepted, "rejected": screened.rejected.iter().map(|(id, r)| json!({"id": id, "reason": r.as_str()})).collect::<Vec<_>>() }),
    ))
}
