//! Wire types. Field names and shapes match `src/v5/engine/types.ts` exactly (camelCase JSON).
use serde::{Deserialize, Serialize};
use rustc_hash::FxHashMap;
use std::collections::BTreeMap;

pub type LngLat = [f64; 2];
pub type Tags = FxHashMap<String, String>;

#[derive(Deserialize)]
pub struct RawWay {
    pub id: i64,
    #[serde(default)]
    pub tags: Tags,
    pub coords: Vec<LngLat>,
    #[serde(default)]
    pub nodes: Option<Vec<i64>>,
}

#[derive(Deserialize)]
pub struct RawBuilding {
    pub id: i64,
    #[serde(default)]
    pub tags: Tags,
    pub ring: Vec<LngLat>,
}

#[derive(Deserialize)]
pub struct RawAddressNode {
    pub id: i64,
    #[serde(default)]
    pub tags: Tags,
    pub point: LngLat,
}

#[derive(Deserialize)]
pub struct RawOsm {
    pub ways: Vec<RawWay>,
    pub buildings: Vec<RawBuilding>,
    pub addresses: Vec<RawAddressNode>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RoadClass {
    Street,
    Access,
    Connector,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub group: String,
    pub chunk: u32,
    pub chunks: u32,
    pub way_id: i64,
    pub name: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub highway: String,
    pub cls: RoadClass,
    pub coords: Vec<LngLat>,
    pub length: f64,
    pub from: String,
    pub to: String,
    pub house_count: u32,
    pub visible: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    #[serde(rename = "building")]
    Building,
    #[serde(rename = "address-node")]
    AddressNode,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Evidence {
    #[serde(rename = "address")]
    Address,
    #[serde(rename = "residential-type")]
    ResidentialType,
    #[serde(rename = "address-node")]
    AddressNode,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct House {
    pub id: String,
    pub osm_id: i64,
    pub source: Source,
    pub number: Option<String>,
    pub street: Option<String>,
    pub ring: Vec<LngLat>,
    pub center: LngLat,
    pub parent: Option<String>,
    pub measure: Option<f64>,
    pub evidence: Evidence,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub engine_version: String,
    pub ways_in: usize,
    pub ways_excluded: BTreeMap<String, u32>,
    pub segments: usize,
    pub visible_segments: usize,
    pub promoted_by_houses: u32,
    pub hidden_connectors: u32,
    pub buildings_in: usize,
    pub houses_out: usize,
    pub buildings_skipped: BTreeMap<String, u32>,
    pub orphan_houses: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Network {
    pub segments: Vec<Segment>,
    pub houses: Vec<House>,
    pub diagnostics: Diagnostics,
}

/// What the app keeps on the main thread: everything except coordinates (those stay in Rust / in tiles).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlimSegment {
    pub id: String,
    pub group: String,
    pub chunk: u32,
    pub chunks: u32,
    pub way_id: i64,
    pub name: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub highway: String,
    pub cls: RoadClass,
    pub length: f64,
    pub from: String,
    pub to: String,
    pub house_count: u32,
    pub visible: bool,
    pub mid: LngLat,
    pub start: LngLat,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlimHouse {
    pub id: String,
    pub osm_id: i64,
    pub source: Source,
    pub number: Option<String>,
    pub street: Option<String>,
    pub center: LngLat,
    pub parent: Option<String>,
    pub measure: Option<f64>,
    pub evidence: Evidence,
}

#[derive(Serialize)]
pub struct SlimNetwork {
    pub segments: Vec<SlimSegment>,
    pub houses: Vec<SlimHouse>,
    pub diagnostics: Diagnostics,
}
