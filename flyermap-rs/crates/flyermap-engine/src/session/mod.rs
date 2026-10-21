//! The engine session: keeps the geometry of every loaded Area (merged "first Area wins", like `mergeNetworks`),
//! cuts vector tiles from it and answers geometry queries, so JavaScript never has to hold coordinates.
mod queries;
mod route;
mod slim;
mod tiles;

use crate::grid::Grid;
use crate::model::*;
use crate::query::Entry;
use crate::tile::mercator;
use rustc_hash::{FxHashMap, FxHashSet};

use route::RouteGraph;
pub use route::RouteOut;
use slim::{bbox, r7};
pub use slim::{midpoint_by_length, slim};

pub const MIN_TILE_ZOOM: u32 = 11;
/// Streets are cut into tiles from this zoom on: below it a 10 m piece is under one pixel, so a city tile would carry every piece of the
/// city (2.7 MB at z11, 1 MB at z13) for a line nobody can tell from the basemap's. The dots show the progress there.
pub const SEGMENTS_FROM: u32 = 14;
/// Up to this zoom the dots are thinned: of the houses inside one `DOT_CELL` (tile units, ~1.5 px) only the first is cut into the tile.
pub const THIN_DOTS_UP_TO: u32 = 13;
const DOT_CELL: f64 = 12.0;
/// Dots (one per house) are drawn up to this zoom, house outlines from `OUTLINE_FROM` on.
pub const CENTERS_UP_TO: u32 = 15;
pub const OUTLINES_FROM: u32 = 15;
const CELL: f64 = 1.0 / 65536.0;

struct Seg {
    key: String,
    line: Vec<[f64; 2]>,
    lnglat: Vec<LngLat>,
    name: Option<String>,
    /// The junction-to-junction street this piece belongs to has at least one house ("Nur Straßen mit Häusern").
    with_houses: bool,
    /// A path or lane (not a road): drawn dashed so that it reads differently from a street.
    path: bool,
    /// Middle of the piece by length, rounded like the slim network (what a lasso tests).
    mid: LngLat,
}
struct Hou {
    key: String,
    num: String,
    ring: Vec<[f64; 2]>,
    center: [f64; 2],
    center_ll: LngLat,
    street: Option<String>,
    number: Option<String>,
}

/// Everything loaded so far: geometry for tiles and queries, the routing graph, the search index and the statuses cut into tiles.
pub struct Session {
    graph: RouteGraph,
    /// Built on the first search after Areas changed.
    search_entries: Option<Vec<Entry>>,
    segs: Vec<Seg>,
    houses: Vec<Hou>,
    seen_seg: FxHashSet<String>,
    seen_house: FxHashSet<String>,
    seg_grid: Grid,
    house_grid: Grid,
    /// Status of the entities that are not open (key → 1 completed, 2 later, 3 not-deliverable): cut into the tiles as `st`, so the map
    /// does not have to be told about every one of them through feature-state (MapLibre walks that whole list for every tile it loads).
    status: FxHashMap<String, u8>,
}

impl Session {
    pub fn new() -> Self {
        Session {
            graph: RouteGraph::default(),
            search_entries: None,
            segs: vec![],
            houses: vec![],
            seen_seg: FxHashSet::default(),
            seen_house: FxHashSet::default(),
            seg_grid: Grid::new(CELL),
            house_grid: Grid::new(CELL),
            status: FxHashMap::default(),
        }
    }

    /// Set (or, with 0, clear) the status of entities; later tiles carry it.
    pub fn set_status(&mut self, entries: Vec<(String, u8)>) {
        for (key, code) in entries {
            if code == 0 || code > 3 {
                self.status.remove(&key);
            } else {
                self.status.insert(key, code);
            }
        }
    }
    fn st(&self, key: &str) -> Option<&'static str> {
        match self.status.get(key) {
            Some(1) => Some("c"),
            Some(2) => Some("l"),
            Some(3) => Some("n"),
            _ => None,
        }
    }

    /// Merge one Area's network: only ids not seen before are drawn (first Area wins), hidden segments are never drawn.
    pub fn add(&mut self, network: &Network) {
        self.search_entries = None;
        let mut group_houses: rustc_hash::FxHashMap<&str, u32> = rustc_hash::FxHashMap::default();
        for s in &network.segments {
            *group_houses.entry(s.group.as_str()).or_insert(0) += s.house_count;
        }
        for s in &network.segments {
            self.graph.add(s);
        }
        for s in &network.segments {
            if !self.seen_seg.insert(s.id.clone()) || !s.visible {
                continue;
            }
            let line: Vec<[f64; 2]> = s.coords.iter().map(|p| mercator(*p)).collect();
            self.seg_grid.insert(bbox(&line));
            let mid = midpoint_by_length(&s.coords)
                .map(|m| [r7(m[0]), r7(m[1])])
                .unwrap_or(s.coords[0]);
            self.segs.push(Seg {
                key: format!("s:{}", s.id),
                line,
                lnglat: s.coords.clone(),
                name: s.name.clone(),
                mid,
                with_houses: group_houses.get(s.group.as_str()).copied().unwrap_or(0) > 0,
                path: matches!(s.cls, RoadClass::Connector),
            });
        }
        for h in &network.houses {
            if !self.seen_house.insert(h.id.clone()) {
                continue;
            }
            let ring: Vec<[f64; 2]> = h.ring.iter().map(|p| mercator(*p)).collect();
            self.house_grid.insert(bbox(&ring));
            self.houses.push(Hou {
                key: format!("h:{}", h.id),
                num: h.number.clone().unwrap_or_default(),
                center: mercator(h.center),
                ring,
                center_ll: h.center,
                street: h.street.clone(),
                number: h.number.clone(),
            });
        }
    }
}
