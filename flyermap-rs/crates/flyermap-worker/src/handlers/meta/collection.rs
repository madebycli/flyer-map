//! The collection side of the boot data: active Runs with their members, the Sammelgebiet, and the Sonder-Marker rights of a helper.
use crate::{
    db::{decode, decode_one, stmt, Db},
    params,
};
use flyermap_rights::{Caller, PickupRights, Role};
use flyermap_wire::{meta::*, Polygon};
use serde::Deserialize;

fn polygon(text: &str) -> Polygon {
    serde_json::from_str(text).unwrap_or(Polygon { coordinates: vec![] })
}

pub(super) async fn runs<D: Db>(db: &D, campaign_id: &str) -> Vec<Run> {
    #[derive(Deserialize)]
    struct RunRow {
        id: String,
        main_area_id: String,
    }
    #[derive(Deserialize)]
    struct MemberRow {
        run_id: String,
        collector_id: String,
        label: String,
    }
    let active = db
        .all(&stmt("SELECT id, main_area_id FROM collection_runs WHERE campaign_id = ? AND status = 'active' ORDER BY started_at, id", params![campaign_id]))
        .await;
    let members = db
        .all(&stmt(
            "SELECT run_id, collector_id, label FROM collection_run_members WHERE campaign_id = ? AND left_at IS NULL ORDER BY joined_at, id",
            params![campaign_id],
        ))
        .await;
    let (Ok(Ok(active)), Ok(Ok(members))) = (active.map(decode::<RunRow>), members.map(decode::<MemberRow>)) else {
        return Vec::new();
    };
    active
        .into_iter()
        .map(|r| Run {
            members: members.iter().filter(|m| m.run_id == r.id).map(|m| RunMember { collector_id: m.collector_id.clone(), label: m.label.clone() }).collect(),
            id: r.id,
            main_area_id: r.main_area_id,
        })
        .collect()
}

pub(super) async fn main_area<D: Db>(db: &D, campaign_id: &str) -> Option<MainArea> {
    #[derive(Deserialize)]
    struct Row {
        id: String,
        name: String,
        geometry_json: String,
        updated_at: String,
    }
    let row =
        db.first(&stmt("SELECT id, name, geometry_json, updated_at FROM collection_main_areas WHERE campaign_id = ?", params![campaign_id])).await.ok()?;
    decode_one::<Row>(row).ok()?.map(|r| MainArea { geometry: polygon(&r.geometry_json), id: r.id, name: r.name, updated_at: r.updated_at })
}

pub(super) async fn pickup_rights<D: Db>(db: &D, caller: &Caller, campaign_id: &str) -> PickupRights {
    #[derive(Deserialize)]
    struct Row {
        can_view_pickups: Option<i64>,
        can_create_pickups: Option<i64>,
        can_edit_pickups: Option<i64>,
    }
    let helper = match caller.collector_id.as_deref() {
        Some(collector) if caller.role == Role::CollectionCollector => {
            let sql = "SELECT can_view_pickups, can_create_pickups, can_edit_pickups FROM collection_collectors WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL LIMIT 1";
            db.first(&stmt(sql, params![collector, campaign_id])).await.ok().and_then(|r| decode_one::<Row>(r).ok().flatten()).map(|r| PickupRights {
                view: r.can_view_pickups == Some(1),
                create: r.can_create_pickups == Some(1),
                edit: r.can_edit_pickups == Some(1),
            })
        }
        _ => None,
    };
    PickupRights::of(caller, helper)
}
