use crate::{
    db::{decode, decode_one, stmt, Db, DbError},
    params,
};
use flyermap_rights::{AreaRef, Caller, CollectionStatus, Role};
use serde::Deserialize;

fn collection_status(text: &str) -> CollectionStatus {
    match text {
        "claimed" => CollectionStatus::Claimed,
        "in-progress" => CollectionStatus::InProgress,
        "completed" => CollectionStatus::Completed,
        "archived" => CollectionStatus::Archived,
        _ => CollectionStatus::Open,
    }
}

#[derive(Deserialize)]
struct DistributionRow {
    id: String,
    team_id: String,
}

#[derive(Deserialize)]
struct CollectionRow {
    id: String,
    status: String,
    run_id: Option<String>,
}

/// A Gebiet of either kind, or `None` when there is none with that id in the Aktion.
pub async fn resolve_area<D: Db>(db: &D, campaign_id: &str, area_id: &str) -> Result<Option<AreaRef>, DbError> {
    let row = db
        .first(&stmt(
            "SELECT id,campaign_id,team_id,name,geometry_json,created_at,updated_at FROM areas WHERE campaign_id=? AND id=?",
            params![campaign_id, area_id],
        ))
        .await?;
    if let Some(r) = decode_one::<DistributionRow>(row)? {
        return Ok(Some(AreaRef::Distribution { id: r.id, team_id: r.team_id }));
    }
    match db
        .first(&stmt(
            "SELECT id, name, status, run_id, geometry_json, updated_at FROM collection_areas WHERE campaign_id = ? AND id = ?",
            params![campaign_id, area_id],
        ))
        .await
    {
        Ok(row) => Ok(decode_one::<CollectionRow>(row)?.map(|r| AreaRef::Collection { id: r.id, status: collection_status(&r.status), run_id: r.run_id })),
        Err(_) => Ok(None), // collection tables not migrated: there are simply no collection Gebiete
    }
}

/// Is this helper an active member of the active Run that holds the Gebiet?
pub async fn collector_works_in<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area: &AreaRef) -> Result<bool, DbError> {
    let AreaRef::Collection { status, run_id: Some(run_id), .. } = area else {
        return Ok(false);
    };
    let Some(collector) = caller.collector_id.as_deref() else {
        return Ok(false);
    };
    if !matches!(status, CollectionStatus::Claimed | CollectionStatus::InProgress) {
        return Ok(false);
    }
    let sql = "SELECT 1 AS ok FROM collection_run_members m JOIN collection_runs r ON r.id = m.run_id AND r.campaign_id = m.campaign_id
      WHERE m.campaign_id = ? AND m.run_id = ? AND m.collector_id = ? AND m.left_at IS NULL AND r.status = 'active'";
    Ok(db.first(&stmt(sql, params![campaign_id, run_id.as_str(), collector])).await?.is_some())
}

/// The server's answer to "may this caller write in this Gebiet right now?".
pub async fn can_write<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area: &AreaRef) -> Result<bool, DbError> {
    let works = caller.role == Role::CollectionCollector && collector_works_in(db, caller, campaign_id, area).await?;
    Ok(flyermap_rights::can_write_area(caller, area, works))
}

/// Which keys of these exist on the server, and in which Gebiet.
pub async fn owners<D: Db>(db: &D, campaign_id: &str, keys: &[String]) -> Result<Vec<(String, String)>, DbError> {
    #[derive(Deserialize)]
    struct Owner {
        key: String,
        area_id: String,
    }
    let mut out = Vec::new();
    for chunk in keys.chunks(90) {
        let marks = vec!["?"; chunk.len()].join(",");
        let mut p = params![campaign_id];
        p.extend(chunk.iter().map(crate::db::Param::from));
        let rows = db.all(&stmt(format!("SELECT key, area_id FROM v5_state WHERE campaign_id = ? AND key IN ({marks})"), p)).await?;
        out.extend(decode::<Owner>(rows)?.into_iter().map(|o| (o.key, o.area_id)));
    }
    Ok(out)
}
