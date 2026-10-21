//! `GET /campaigns/:id/state?since=N&limit=M`: rows newer than the cursor, oldest first, only from Gebiete the caller may read.
use super::Outcome;
use crate::{
    db::{decode, stmt, Db},
    http::{jsnum::trunc_or, request::Request, response::Response},
    params, repo,
};
use flyermap_rights::Caller;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Row {
    key: String,
    op_id: String,
    status: String,
    area_id: String,
    actor: String,
    seq: i64,
}

pub async fn pull<D: Db>(db: &D, caller: &Caller, campaign_id: &str, request: &Request, now: u64) -> Outcome {
    let since = trunc_or(request.query("since").as_deref(), "0", 0.0).max(0.0) as i64;
    let limit = trunc_or(request.query("limit").as_deref(), "1000", 1000.0).clamp(1.0, 1000.0) as i64;
    let (scope, scope_params) = repo::state::readable_areas(caller, campaign_id);
    let mut p = params![campaign_id, since];
    p.extend(scope_params);
    p.push((limit + 1).into());
    let rows: Vec<Row> = decode(
        db.all(&stmt(
            format!("SELECT key, op_id, status, area_id, actor, seq FROM v5_state WHERE campaign_id = ? AND seq > ?{scope} ORDER BY seq ASC LIMIT ?"),
            p,
        ))
        .await?,
    )?;
    let more = rows.len() as i64 > limit;
    let page = &rows[..rows.len().min(limit as usize)];
    Ok(Response::json(
        200,
        &json!({
            "ops": page.iter().map(|r| json!({"id": r.op_id, "key": r.key, "status": r.status, "by": r.actor, "area": r.area_id})).collect::<Vec<_>>(),
            "cursor": page.last().map_or(since, |r| r.seq),
            "more": more,
            "serverNow": now,
        }),
    ))
}
