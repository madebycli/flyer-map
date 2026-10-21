//! `GET /campaigns/:id/meta`: everything the app needs to boot in one small request.
mod collection;

use super::{fail, Outcome};
use crate::{
    access::hash::sha256_hex,
    app::Options,
    db::{decode, stmt, Db, DbError},
    http::{request::Request, response::Response},
    params, repo,
};
use collection::{main_area, pickup_rights, runs};
use flyermap_rights::{is_scoped, writes_allowed, Caller, PickupRights, Role};
use flyermap_wire::{meta::*, ErrorCode, Polygon};
use serde::Deserialize;

#[derive(Deserialize)]
struct AreaRow {
    id: String,
    name: String,
    team_id: String,
    geometry_json: String,
    updated_at: String,
    pack_version: Option<u32>,
    pack_hash: Option<String>,
    status: Option<String>,
    run_id: Option<String>,
    claimed_by_label: Option<String>,
    claimed_by_collector_id: Option<String>,
    color: Option<String>,
}

fn polygon(text: &str) -> Polygon {
    serde_json::from_str(text).unwrap_or(Polygon {
        coordinates: vec![],
    })
}

/// The first 12 bytes of SHA-256 over the stored outline: a pack built for another outline is stale.
fn geometry_hash(geometry_json: &str) -> String {
    sha256_hex(geometry_json)[..24].to_string()
}

pub async fn meta<D: Db>(
    db: &D,
    caller: &Caller,
    campaign_id: &str,
    request: &Request,
    options: &Options,
) -> Outcome {
    let Some(campaign) = repo::campaign::campaign(db, campaign_id).await? else {
        return fail(ErrorCode::NotFound, "Aktion nicht gefunden.");
    };
    // A helper only ever sees the collection side; admins and viewers choose with ?kind=collection.
    let wants_collection = request.query("kind").as_deref() == Some("collection")
        && matches!(caller.role, Role::Admin | Role::Viewer);
    let kind = if caller.role == Role::CollectionCollector || wants_collection {
        Kind::Collection
    } else {
        Kind::Distribution
    };
    let scoped = is_scoped(caller);
    let rows = area_rows(db, caller, campaign_id, kind).await?;
    let mut areas = Vec::with_capacity(rows.len());
    for a in rows {
        let stale = a.pack_version.is_some()
            && a.pack_hash.as_deref() != Some(geometry_hash(&a.geometry_json).as_str());
        let writable = match repo::areas::resolve_area(db, campaign_id, &a.id).await? {
            Some(area_ref) => repo::areas::can_write(db, caller, campaign_id, &area_ref).await?,
            None => false,
        };
        let collection = (kind == Kind::Collection).then(|| CollectionInfo {
            status: serde_json::from_value(serde_json::Value::String(
                a.status.clone().unwrap_or_else(|| "open".into()),
            ))
            .unwrap_or(flyermap_rights::CollectionStatus::Open),
            color: a.color.clone().unwrap_or_else(|| "#2563eb".into()),
            run_id: a.run_id.clone(),
            claimed_by: a.claimed_by_label.clone(),
            claimed_by_id: a.claimed_by_collector_id.clone(),
        });
        areas.push(Area {
            id: a.id,
            name: a.name,
            team_id: a.team_id,
            geometry: polygon(&a.geometry_json),
            updated_at: a.updated_at,
            pack_version: if stale { None } else { a.pack_version },
            pack_stale: stale,
            writable,
            collection,
        });
    }
    let teams = if kind == Kind::Collection {
        Vec::new()
    } else {
        teams(db, campaign_id).await?
    };
    let main = if kind == Kind::Collection {
        main_area(db, campaign_id).await
    } else {
        None
    };
    let meta = Meta {
        window: if kind == Kind::Distribution {
            repo::campaign::window(db, campaign_id).await?
        } else {
            None
        },
        guest_room: caller.room_id.clone(),
        role: caller.role,
        team_id: caller.team_id.clone(),
        me: Me {
            label: caller.label.clone(),
        },
        collector_id: caller.collector_id.clone(),
        collector_label: caller.collector_id.as_ref().and(caller.label.clone()),
        runs: if kind == Kind::Collection {
            runs(db, campaign_id).await
        } else {
            Vec::new()
        },
        main_area_id: main.as_ref().map(|m| m.id.clone()),
        main_area: main,
        pickup_rights: if kind == Kind::Collection {
            pickup_rights(db, caller, campaign_id).await
        } else {
            PickupRights::default()
        },
        can_write: writes_allowed(caller),
        can_build_pack: matches!(
            caller.role,
            Role::Admin | Role::TeamEditor | Role::CollectionCollector
        ),
        teams: if scoped {
            teams
                .into_iter()
                .filter(|t| Some(&t.id) == caller.team_id.as_ref())
                .collect()
        } else {
            teams
        },
        areas,
        context_areas: if kind == Kind::Distribution && scoped {
            context_areas(db, caller, campaign_id).await?
        } else {
            Vec::new()
        },
        basemap: options
            .basemap
            .clone()
            .filter(|b| b.dark.is_some() || b.light.is_some()),
        kind,
        campaign,
    };
    Ok(Response::json(200, &meta))
}

async fn area_rows<D: Db>(
    db: &D,
    caller: &Caller,
    campaign_id: &str,
    kind: Kind,
) -> Result<Vec<AreaRow>, DbError> {
    if kind == Kind::Collection {
        let archived = if caller.role == Role::Admin {
            ""
        } else {
            " AND a.status <> 'archived'"
        };
        let sql = format!(
            "SELECT a.id, a.name, '' AS team_id, a.geometry_json, a.updated_at, a.status, a.color, a.run_id, a.claimed_by_label, a.claimed_by_collector_id, p.version AS pack_version, p.geometry_hash AS pack_hash FROM collection_areas a
         LEFT JOIN v5_pack_meta p ON p.campaign_id = a.campaign_id AND p.area_id = a.id
         WHERE a.campaign_id = ?{archived} ORDER BY a.created_at, a.id"
        );
        return Ok(match db.all(&stmt(sql, params![campaign_id])).await {
            Ok(rows) => decode(rows)?,
            Err(_) => Vec::new(),
        });
    }
    let scoped = is_scoped(caller);
    let guest = scoped && caller.room_area_id.is_some();
    let sql = format!(
        "SELECT a.id, a.name, a.team_id, a.geometry_json, a.updated_at, p.version AS pack_version, p.geometry_hash AS pack_hash FROM areas a
       LEFT JOIN v5_pack_meta p ON p.campaign_id = a.campaign_id AND p.area_id = a.id
       WHERE a.campaign_id = ?{}{} ORDER BY a.created_at, a.id",
        if scoped { " AND a.team_id = ?" } else { "" },
        if guest { " AND a.id = ?" } else { "" }
    );
    let mut p = params![campaign_id];
    if scoped {
        p.push(caller.team_id.clone().into());
    }
    if guest {
        p.push(caller.room_area_id.clone().into());
    }
    decode(db.all(&stmt(sql, p)).await?)
}

async fn teams<D: Db>(db: &D, campaign_id: &str) -> Result<Vec<Team>, DbError> {
    #[derive(Deserialize)]
    struct Row {
        id: String,
        name: String,
        color: String,
        updated_at: String,
    }
    let rows: Vec<Row> = decode(
        db.all(&stmt(
            "SELECT id, name, color, updated_at FROM teams WHERE campaign_id = ? ORDER BY name, id",
            params![campaign_id],
        ))
        .await?,
    )?;
    Ok(rows
        .into_iter()
        .map(|r| Team {
            id: r.id,
            name: r.name,
            color: r.color,
            updated_at: r.updated_at,
        })
        .collect())
}

async fn context_areas<D: Db>(
    db: &D,
    caller: &Caller,
    campaign_id: &str,
) -> Result<Vec<ContextArea>, DbError> {
    #[derive(Deserialize)]
    struct Row {
        geometry_json: String,
    }
    let room = caller.room_area_id.is_some();
    let sql = format!("SELECT geometry_json FROM areas WHERE campaign_id = ? AND NOT (team_id = ?{}) ORDER BY created_at, id", if room { " AND id = ?" } else { "" });
    let mut p = params![campaign_id, caller.team_id.clone()];
    if room {
        p.push(caller.room_area_id.clone().into());
    }
    Ok(decode::<Row>(db.all(&stmt(sql, p)).await?)?
        .into_iter()
        .map(|r| ContextArea {
            geometry: polygon(&r.geometry_json),
        })
        .collect())
}
