//! Derive the delivery network from raw OSM: ways become street pieces, buildings and address nodes become houses, each house gets its street.
//! One file per step; this one only runs them in order. Byte-compatible with `src/v5/engine` in TypeScript.
mod houses;
mod index;
mod parent;
mod segments;
mod text;
mod visibility;

use crate::classify::{classify_building, classify_road, BuildingVerdict};
use crate::geo::*;
use crate::grid::Grid;
use crate::model::*;
use index::Indexed;
use parent::assign_parent;
use rustc_hash::{FxHashMap as HashMap, FxHashSet as HashSet};
use text::{bump, non_empty, normalize_name, trimmed, vertex_key};

pub use text::js_trim;

pub const ENGINE_VERSION: &str = "v5.6";
pub const CHUNK_METERS: f64 = 10.0;
const MAX_PARENT_DISTANCE: f64 = 45.0;
const MAX_NAMED_PARENT_DISTANCE: f64 = 80.0;
const ADDRESS_NODE_SNAP: f64 = 8.0;
const SCORE_EPS: f64 = 1e-6;
/// How far a house on a path may be from the street its address names for that street to take it along when it is marked.
const MAX_STREET_LINK_DISTANCE: f64 = 200.0;

pub fn derive_network(raw: &RawOsm) -> Network {
    let mut diag = Diagnostics { engine_version: ENGINE_VERSION.into(), ways_in: raw.ways.len(), buildings_in: raw.buildings.len(), ..Default::default() };
    let frame = frame_for(
        raw.ways.iter().flat_map(|w| w.coords.iter()).chain(raw.buildings.iter().flat_map(|b| b.ring.iter())).chain(raw.addresses.iter().map(|a| &a.point)),
    );

    let ways = segments::candidate_ways(raw, &mut diag);
    let segments = segments::split_ways(&ways);
    diag.segments = segments.len();
    let (mut seg_grid, indexed) = index::index_segments(&segments, &frame);
    let mut houses = houses::derive_houses(raw, &frame, &mut seg_grid, &indexed, &segments, &mut diag);
    parent::link_path_houses(&mut houses, &segments, &frame, &mut seg_grid, &indexed, &mut diag);
    visibility::finish(segments, houses, diag)
}
