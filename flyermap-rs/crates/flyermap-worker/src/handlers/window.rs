//! `PUT /campaigns/:id/window`: the Aktion's time window (the countdown counts to its end). Admins only.
use super::{body::read_json, fail, Outcome};
use crate::{
    db::{stmt, Db},
    http::{request::Request, response::Response},
    params,
    time::{iso, parse_iso_ms},
};
use flyermap_rights::{Caller, Role};
use flyermap_wire::ErrorCode;
use serde_json::{json, Value};

const MIN_MS: i64 = 946_684_800_000; // 2000-01-01
const MAX_MS: i64 = 4_102_444_800_000; // 2100-01-01

enum Parsed {
    Empty,
    At(String),
    Bad,
}

fn parse(value: Option<&Value>) -> Parsed {
    match value {
        None | Some(Value::Null) => Parsed::Empty,
        Some(Value::String(s)) if s.is_empty() => Parsed::Empty,
        Some(Value::String(s)) => match parse_iso_ms(s) {
            Some(ms) if ms > MIN_MS && ms < MAX_MS => Parsed::At(iso(ms as u64)),
            _ => Parsed::Bad,
        },
        Some(_) => Parsed::Bad,
    }
}

pub async fn put<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request) -> Outcome {
    if caller.role != Role::Admin {
        return fail(ErrorCode::Forbidden, "Nur Admins legen das Zeitfenster fest.");
    }
    let body = match read_json(request, 10_000) {
        Ok(b) => b,
        Err(response) => return Ok(response),
    };
    let (starts, ends) = match (parse(body.get("startsAt")), parse(body.get("endsAt"))) {
        (Parsed::Bad, _) | (_, Parsed::Bad) => return fail(ErrorCode::InvalidWindow, "Datum ungültig."),
        (s, e) => (
            match s {
                Parsed::At(v) => Some(v),
                _ => None,
            },
            match e {
                Parsed::At(v) => Some(v),
                _ => None,
            },
        ),
    };
    if let (Some(s), Some(e)) = (&starts, &ends) {
        if parse_iso_ms(e) <= parse_iso_ms(s) {
            return fail(ErrorCode::InvalidWindow, "Das Ende muss nach dem Start liegen.");
        }
    }
    let changed = db
        .batch(&[stmt("UPDATE campaigns SET window_starts_at = ?, window_ends_at = ? WHERE id = ?", params![starts.clone(), ends.clone(), campaign_id])])
        .await?;
    if changed.first() != Some(&1) {
        return fail(ErrorCode::NotFound, "Aktion nicht gefunden.");
    }
    let window = if starts.is_some() || ends.is_some() { json!({"startsAt": starts, "endsAt": ends}) } else { Value::Null };
    Ok(Response::json(200, &json!({ "window": window })))
}
