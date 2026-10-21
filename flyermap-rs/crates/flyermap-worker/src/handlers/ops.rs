//! `POST /campaigns/:id/ops`: judge a batch of edits (flyermap-rights), protect other Gruppen's keys, write the newest per key atomically.
use super::{fail, Outcome};
use crate::{
    db::Db,
    http::{request::Request, response::Response},
    repo,
};
use flyermap_rights::{is_scoped, screen_ops, writes_allowed, Caller, RawOp, MAX_OPS};
use flyermap_wire::ErrorCode;
use serde_json::{json, Value};
use std::collections::HashMap;

const MAX_BODY: usize = 100_000;

fn raw_op(v: &Value) -> RawOp {
    let Some(o) = v.as_object() else {
        return RawOp::NotAnObject;
    };
    let text = |k: &str| o.get(k).and_then(Value::as_str).map(str::to_string);
    RawOp::Fields {
        id: text("id"),
        key: text("key"),
        status: text("status"),
        area: text("area"),
    }
}

pub async fn push<D: Db>(
    db: &D,
    caller: &Caller,
    campaign_id: &str,
    request: &Request,
    now: u64,
) -> Outcome {
    if !writes_allowed(caller) {
        return fail(ErrorCode::ReadOnly, "Diese Rolle darf nichts markieren.");
    }
    if !request
        .header("content-type")
        .unwrap_or("")
        .contains("application/json")
    {
        return fail(ErrorCode::UnsupportedMediaType, "JSON erwartet.");
    }
    let text = request.body_text();
    if text.encode_utf16().count() > MAX_BODY {
        return fail(ErrorCode::TooLarge, "Zu viele Änderungen auf einmal.");
    }
    let Ok(body) = serde_json::from_str::<Value>(&text) else {
        return fail(ErrorCode::InvalidJson, "Ungültiges JSON.");
    };
    let Some(body) = body.as_object() else {
        return fail(ErrorCode::InvalidJson, "JSON-Objekt erwartet.");
    };
    let ops = match body.get("ops").and_then(Value::as_array) {
        Some(ops) if !ops.is_empty() && ops.len() <= MAX_OPS => ops,
        _ => {
            return fail(
                ErrorCode::InvalidOps,
                &format!("1 bis {MAX_OPS} Änderungen erwartet."),
            )
        }
    };
    let raw: Vec<RawOp> = ops.iter().map(raw_op).collect();

    // The rule asks per Gebiet; the answers need the database, so they are fetched first (only for ids that could pass).
    let mut writable: HashMap<String, bool> = HashMap::new();
    for op in &raw {
        if let RawOp::Fields {
            area: Some(area), ..
        } = op
        {
            if crate::http::router::is_id(area) && !writable.contains_key(area) {
                let ok = match repo::areas::resolve_area(db, campaign_id, area).await? {
                    Some(area_ref) => {
                        repo::areas::can_write(db, caller, campaign_id, &area_ref).await?
                    }
                    None => false,
                };
                writable.insert(area.clone(), ok);
            }
        }
    }
    let mut screened = screen_ops(&raw, now, |area| {
        writable.get(area).copied().unwrap_or(false)
    });
    if !screened.latest.is_empty() && is_scoped(caller) {
        let keys: Vec<String> = screened.latest.keys().map(|k| k.to_string()).collect();
        let owners = repo::areas::owners(db, campaign_id, &keys).await?;
        screened.enforce_key_owners(
            &owners
                .into_iter()
                .map(|(k, a)| (flyermap_core::Key::new(k), a))
                .collect(),
        );
    }
    if !screened.latest.is_empty() {
        let rows = screened.writes_in_order();
        let actor: String = caller
            .label
            .clone()
            .unwrap_or_else(|| caller.grant_id.clone())
            .chars()
            .take(80)
            .collect();
        let statements = repo::state::write_statements(
            campaign_id,
            &rows,
            &actor,
            &caller.grant_id,
            is_scoped(caller),
        );
        if db.batch(&statements).await.is_err() {
            return fail(
                ErrorCode::WriteFailed,
                "Änderungen konnten nicht gespeichert werden.",
            );
        }
    }
    Ok(Response::json(
        200,
        &json!({
            "accepted": screened.accepted,
            "rejected": screened.rejected.iter().map(|r| json!({"id": r.id, "reason": r.reason.as_str()})).collect::<Vec<_>>(),
        }),
    ))
}
