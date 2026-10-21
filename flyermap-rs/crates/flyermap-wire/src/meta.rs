//! `GET /campaigns/:id/meta`: everything the app needs to boot, in one small request (role, Gruppen, Gebiete and their pack versions).
use crate::geometry::Polygon;
use flyermap_rights::{CollectionStatus, PickupRights, Role};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Distribution,
    Collection,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CampaignRef {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Me {
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
    pub color: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMember {
    pub collector_id: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub main_area_id: String,
    pub members: Vec<RunMember>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainArea {
    pub id: String,
    pub name: String,
    pub geometry: Polygon,
    pub updated_at: String,
}

/// What is special about a Gebiet of the collection side.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub status: CollectionStatus,
    pub color: String,
    pub run_id: Option<String>,
    pub claimed_by: Option<String>,
    pub claimed_by_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: String,
    pub name: String,
    pub team_id: String,
    pub geometry: Polygon,
    pub updated_at: String,
    pub pack_version: Option<u32>,
    #[serde(default)]
    pub pack_stale: bool,
    /// Decided by the server for this caller right now; the interface only mirrors it.
    pub writable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<CollectionInfo>,
}

/// Outline of a Gebiet the person does not work in: geometry only, no id, name, Gruppe, pack or progress.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContextArea {
    pub geometry: Polygon,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Basemap {
    pub dark: Option<String>,
    pub light: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub campaign: CampaignRef,
    pub kind: Kind,
    pub window: Option<TimeWindow>,
    pub guest_room: Option<String>,
    pub role: Role,
    pub team_id: Option<String>,
    pub me: Me,
    pub collector_id: Option<String>,
    pub collector_label: Option<String>,
    pub runs: Vec<Run>,
    pub main_area: Option<MainArea>,
    pub main_area_id: Option<String>,
    pub pickup_rights: PickupRights,
    pub can_write: bool,
    pub can_build_pack: bool,
    pub teams: Vec<Team>,
    pub areas: Vec<Area>,
    pub context_areas: Vec<ContextArea>,
    pub basemap: Option<Basemap>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_meta_from_the_typescript_worker_reads_and_writes_back_unchanged() {
        let text = r##"{"campaign":{"id":"campaign_n","name":"Test"},"kind":"distribution","window":null,"guestRoom":null,"role":"team-editor","teamId":"team_n","me":{"label":"Nutzer 2"},
          "collectorId":null,"collectorLabel":null,"runs":[],"mainArea":null,"mainAreaId":null,"pickupRights":{"view":false,"create":false,"edit":false},"canWrite":true,"canBuildPack":true,
          "teams":[{"id":"team_n","name":"Nord","color":"#2563eb","updatedAt":"2026-09-07T00:00:00.000Z"}],
          "areas":[{"id":"area_n","name":"Area","teamId":"team_n","geometry":{"type":"Polygon","coordinates":[[[13.0,51.0],[13.1,51.0],[13.1,51.1],[13.0,51.0]]]},"updatedAt":"2026-09-07T00:00:00.000Z","packVersion":3,"packStale":false,"writable":true}],
          "contextAreas":[],"basemap":{"dark":"https://x/dark.json","light":null}}"##;
        let meta: Meta = serde_json::from_str(text).unwrap();
        assert_eq!(meta.role, Role::TeamEditor);
        assert_eq!(meta.areas[0].geometry.outer().len(), 4);
        let again: serde_json::Value = serde_json::to_value(&meta).unwrap();
        assert_eq!(
            again,
            serde_json::from_str::<serde_json::Value>(text).unwrap()
        );
    }
}
