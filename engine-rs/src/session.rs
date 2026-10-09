//! The engine session: keeps the geometry of every loaded Area (merged "first Area wins", like `mergeNetworks`),
//! cuts vector tiles from it and answers geometry queries, so JavaScript never has to hold coordinates.
use crate::grid::Grid;
use crate::model::*;
use crate::mvt::{encode_tile, GeomType, Layer};
use crate::query::{self, Entry, Lasso};
use crate::tile::{clip_line, clip_ring, mercator, to_tile, BUFFER, EXTENT};
use rustc_hash::{FxHashMap, FxHashSet};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub const MIN_TILE_ZOOM: u32 = 11;
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
    /// Middle of the piece by length, rounded like the slim network (what a lasso tests).
    mid: LngLat,
}
struct Hou { key: String, num: String, ring: Vec<[f64; 2]>, center: [f64; 2], center_ll: LngLat, street: Option<String>, number: Option<String> }

/// Street graph for routing: every segment (hidden connectors included), nodes interned, first Area wins.
#[derive(Default)]
struct RouteGraph {
    ids: Vec<String>,
    index: FxHashMap<String, u32>,
    from: Vec<u32>,
    to: Vec<u32>,
    length: Vec<f64>,
    visible: Vec<bool>,
    name: Vec<Option<String>>,
    group: Vec<u32>,
    house_count: Vec<u32>,
    /// houses along each junction-to-junction street (sum over its pieces), by group index
    group_houses: Vec<u32>,
    groups: FxHashMap<String, u32>,
    /// segment indices touching each node, in insertion order (the same order the TypeScript reference iterates)
    at: Vec<Vec<u32>>,
    nodes: FxHashMap<String, u32>,
}

impl RouteGraph {
    fn node(&mut self, key: &str) -> u32 {
        if let Some(&n) = self.nodes.get(key) { return n; }
        let n = self.at.len() as u32;
        self.nodes.insert(key.to_string(), n);
        self.at.push(Vec::new());
        n
    }
    fn add(&mut self, s: &Segment) {
        if self.index.contains_key(&s.id) { return; }
        let i = self.ids.len() as u32;
        let (from, to) = (self.node(&s.from), self.node(&s.to));
        self.index.insert(s.id.clone(), i);
        self.ids.push(s.id.clone());
        self.from.push(from);
        self.to.push(to);
        self.length.push(s.length);
        self.visible.push(s.visible);
        let group = match self.groups.get(&s.group) { Some(&g) => g, None => { let g = self.group_houses.len() as u32; self.groups.insert(s.group.clone(), g); self.group_houses.push(0); g } };
        self.group_houses[group as usize] += s.house_count;
        self.name.push(s.name.clone());
        self.group.push(group);
        self.house_count.push(s.house_count);
        self.at[from as usize].push(i);
        self.at[to as usize].push(i);
    }
}

/// Min-heap entry ordered by (cost, segment order), like the reference implementation.
struct Item { cost: f64, order: u32 }
impl PartialEq for Item { fn eq(&self, o: &Self) -> bool { self.cost == o.cost && self.order == o.order } }
impl Eq for Item {}
impl PartialOrd for Item { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        // BinaryHeap is a max-heap: reverse so the smallest (cost, order) pops first
        o.cost.partial_cmp(&self.cost).unwrap_or(Ordering::Equal).then(o.order.cmp(&self.order))
    }
}

pub enum RouteOut { Selected { ids: Vec<String>, length: f64, ambiguous: bool }, Disconnected }

impl RouteGraph {
    fn shortest(&self, from: u32, to: u32, banned: Option<u32>) -> Option<(Vec<u32>, f64)> {
        if from == to { return Some((vec![from], self.length[from as usize])); }
        let n = self.ids.len();
        let mut dist = vec![f64::INFINITY; n];
        let mut prev = vec![u32::MAX; n];
        let mut heap = BinaryHeap::new();
        dist[from as usize] = 0.0;
        heap.push(Item { cost: 0.0, order: from });
        while let Some(Item { cost, order: id }) = heap.pop() {
            if cost > dist[id as usize] { continue; }
            if id == to { break; }
            for node in [self.from[id as usize], self.to[id as usize]] {
                for &next in &self.at[node as usize] {
                    if next == id || Some(next) == banned { continue; }
                    let step = self.length[next as usize] * if self.visible[next as usize] { 1.0 } else { 1.6 };
                    let cost_next = cost + step;
                    if cost_next < dist[next as usize] { dist[next as usize] = cost_next; prev[next as usize] = id; heap.push(Item { cost: cost_next, order: next }); }
                }
            }
        }
        if dist[to as usize] == f64::INFINITY { return None; }
        let mut ids = vec![to];
        while *ids.last().unwrap() != from { ids.push(prev[*ids.last().unwrap() as usize]); }
        ids.reverse();
        let length = ids.iter().fold(0.0, |sum, &i| sum + self.length[i as usize]);
        Some((ids, length))
    }

    /// Shortest route through the anchors in order; `ambiguous` when banning any (sampled) interior piece still leaves a route within 12 %.
    fn route(&self, anchors: &[String]) -> RouteOut {
        let mut idx = Vec::with_capacity(anchors.len());
        for a in anchors { match self.index.get(a) { Some(&i) => idx.push(i), None => return RouteOut::Disconnected } }
        if idx.is_empty() { return RouteOut::Disconnected; }
        let mut merged: Vec<u32> = Vec::new();
        let mut ambiguous = false;
        for w in idx.windows(2) {
            let Some((ids, length)) = self.shortest(w[0], w[1], None) else { return RouteOut::Disconnected };
            for &id in &ids { if merged.last() != Some(&id) { merged.push(id); } }
            let interior = if ids.len() > 2 { &ids[1..ids.len() - 1] } else { &ids[0..0] };
            let step = ((interior.len() as f64 / 12.0).ceil() as usize).max(1);
            let mut k = 0;
            while k < interior.len() {
                if let Some((_, alt)) = self.shortest(w[0], w[1], Some(interior[k])) { if alt <= length * 1.12 { ambiguous = true; break; } }
                k += step;
            }
        }
        if idx.len() == 1 { merged.push(idx[0]); }
        let length = merged.iter().fold(0.0, |sum, &i| sum + self.length[i as usize]);
        RouteOut::Selected { ids: merged.iter().map(|&i| self.ids[i as usize].clone()).collect(), length, ambiguous }
    }
}

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
}

fn bbox(pts: &[[f64; 2]]) -> [f64; 4] {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in pts {
        x0 = x0.min(p[0]); x1 = x1.max(p[0]); y0 = y0.min(p[1]); y1 = y1.max(p[1]);
    }
    [x0, y0, x1, y1]
}

/// Same rule as `midpointByLength` in legacy.ts (degrees, not metres — it only has to be stable and central).
pub fn midpoint_by_length(coords: &[LngLat]) -> Option<LngLat> {
    if coords.len() < 2 { return None; }
    let mut lengths = Vec::with_capacity(coords.len() - 1);
    let mut total = 0.0;
    for i in 1..coords.len() {
        let d = (coords[i][0] - coords[i - 1][0]).hypot(coords[i][1] - coords[i - 1][1]);
        lengths.push(d);
        total += d;
    }
    let mut rest = total / 2.0;
    for i in 0..lengths.len() {
        if rest <= lengths[i] || i == lengths.len() - 1 {
            let t = if lengths[i] == 0.0 { 0.0 } else { rest / lengths[i] };
            return Some([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]);
        }
        rest -= lengths[i];
    }
    None
}

fn r7(v: f64) -> f64 { (v * 1e7 + 0.5).floor() / 1e7 }

pub fn slim(network: &Network) -> SlimNetwork {
    let segments = network.segments.iter().map(|s| {
        let m = midpoint_by_length(&s.coords).unwrap_or(s.coords[0]);
        SlimSegment {
            id: s.id.clone(), group: s.group.clone(), chunk: s.chunk, chunks: s.chunks, way_id: s.way_id, name: s.name.clone(), reference: s.reference.clone(),
            highway: s.highway.clone(), cls: s.cls, length: s.length, from: s.from.clone(), to: s.to.clone(), house_count: s.house_count, visible: s.visible,
            mid: [r7(m[0]), r7(m[1])], start: s.coords[0],
        }
    }).collect();
    let houses = network.houses.iter().map(|h| SlimHouse {
        id: h.id.clone(), osm_id: h.osm_id, source: h.source, number: h.number.clone(), street: h.street.clone(), center: h.center, parent: h.parent.clone(), measure: h.measure, evidence: h.evidence,
    }).collect();
    SlimNetwork { segments, houses, diagnostics: network.diagnostics.clone() }
}

impl Session {
    pub fn new() -> Self {
        Session { graph: RouteGraph::default(), search_entries: None, segs: vec![], houses: vec![], seen_seg: FxHashSet::default(), seen_house: FxHashSet::default(), seg_grid: Grid::new(CELL), house_grid: Grid::new(CELL) }
    }

    /// Merge one Area's network: only ids not seen before are drawn (first Area wins), hidden segments are never drawn.
    pub fn add(&mut self, network: &Network) {
        self.search_entries = None;
        let mut group_houses: rustc_hash::FxHashMap<&str, u32> = rustc_hash::FxHashMap::default();
        for s in &network.segments { *group_houses.entry(s.group.as_str()).or_insert(0) += s.house_count; }
        for s in &network.segments { self.graph.add(s); }
        for s in &network.segments {
            if !self.seen_seg.insert(s.id.clone()) || !s.visible { continue; }
            let line: Vec<[f64; 2]> = s.coords.iter().map(|p| mercator(*p)).collect();
            self.seg_grid.insert(bbox(&line));
            let mid = midpoint_by_length(&s.coords).map(|m| [r7(m[0]), r7(m[1])]).unwrap_or(s.coords[0]);
            self.segs.push(Seg { key: format!("s:{}", s.id), line, lnglat: s.coords.clone(), name: s.name.clone(), mid, with_houses: group_houses.get(s.group.as_str()).copied().unwrap_or(0) > 0 });
        }
        for h in &network.houses {
            if !self.seen_house.insert(h.id.clone()) { continue; }
            let ring: Vec<[f64; 2]> = h.ring.iter().map(|p| mercator(*p)).collect();
            self.house_grid.insert(bbox(&ring));
            self.houses.push(Hou { key: format!("h:{}", h.id), num: h.number.clone().unwrap_or_default(), center: mercator(h.center), ring, center_ll: h.center, street: h.street.clone(), number: h.number.clone() });
        }
    }


    /// MVT bytes for tile z/x/y; empty when there is nothing to draw (or the zoom is below the first level).
    pub fn tile(&mut self, z: u32, x: u32, y: u32) -> Vec<u8> {
        if z < MIN_TILE_ZOOM || z > 22 { return Vec::new(); }
        let n = (1u64 << z) as f64;
        let pad = (BUFFER / EXTENT) / n;
        let q = [x as f64 / n - pad, y as f64 / n - pad, (x + 1) as f64 / n + pad, (y + 1) as f64 / n + pad];
        let mut ids: Vec<u32> = Vec::new();
        let mut segments = Layer::new("segments");
        self.seg_grid.search(q, &mut ids);
        ids.sort_unstable();
        for &i in &ids {
            let s = &self.segs[i as usize];
            let pts: Vec<[f64; 2]> = s.line.iter().map(|p| to_tile(*p, z, x, y)).collect();
            let parts = clip_line(&pts);
            if !parts.is_empty() { segments.add(GeomType::Line, &[("key", &s.key), ("h", if s.with_houses { "1" } else { "0" })], &parts); }
        }
        let mut houses = Layer::new("houses");
        let mut centers = Layer::new("centers");
        self.house_grid.search(q, &mut ids);
        ids.sort_unstable();
        for &i in &ids {
            let h = &self.houses[i as usize];
            if z >= OUTLINES_FROM {
                let ring: Vec<[f64; 2]> = h.ring.iter().map(|p| to_tile(*p, z, x, y)).collect();
                if let Some(r) = clip_ring(&ring) { houses.add(GeomType::Polygon, &[("key", &h.key), ("num", &h.num)], &[r]); }
            }
            if z <= CENTERS_UP_TO {
                let c = to_tile(h.center, z, x, y);
                if c[0] >= -BUFFER && c[0] <= EXTENT + BUFFER && c[1] >= -BUFFER && c[1] <= EXTENT + BUFFER {
                    centers.add(GeomType::Point, &[("key", &h.key)], &[vec![[c[0].round() as i32, c[1].round() as i32]]]);
                }
            }
        }
        encode_tile(&[segments, houses, centers])
    }

    /// Houses whose centre and visible street pieces whose middle lie inside the shape (ids); `houses_only` skips streets without a house.
    pub fn lasso(&self, ring: &[LngLat], houses_only: bool) -> (Vec<String>, Vec<String>) {
        let Some(shape) = Lasso::new(ring) else { return (Vec::new(), Vec::new()) };
        let houses = self.houses.iter().filter(|h| shape.contains(h.center_ll)).map(|h| h.key[2..].to_string()).collect();
        let segments = self.segs.iter().filter(|s| (!houses_only || s.with_houses) && shape.contains(s.mid)).map(|s| s.key[2..].to_string()).collect();
        (houses, segments)
    }

    fn build_search(&self) -> Vec<Entry> {
        let g = &self.graph;
        // one entry per street name: the junction-to-junction street with the most houses (earliest on a tie) is where it points
        struct Street { id: u32, houses: u32, total: u32, seen: FxHashSet<u32> }
        let mut order: Vec<&str> = Vec::new();
        let mut streets: FxHashMap<&str, Street> = FxHashMap::default();
        for i in 0..g.ids.len() {
            if !g.visible[i] { continue; }
            let Some(name) = g.name[i].as_deref() else { continue };
            if name.is_empty() { continue; }
            let group = g.group[i];
            let houses = g.group_houses[group as usize];
            let street = streets.entry(name).or_insert_with(|| { order.push(name); Street { id: i as u32, houses: 0, total: 0, seen: FxHashSet::default() } });
            if street.seen.insert(group) {
                street.total += houses;
                if street.seen.len() == 1 || houses > street.houses { street.houses = houses; street.id = i as u32; }
            }
        }
        let mut entries = Vec::with_capacity(order.len() + self.houses.len());
        for name in order {
            let street = &streets[name];
            entries.push(Entry { street: true, id: g.ids[street.id as usize].clone(), label: name.to_string(), detail: format!("{} Häuser", street.total), norm: query::fold(name) });
        }
        for h in &self.houses {
            let (Some(street), Some(number)) = (h.street.as_deref(), h.number.as_deref()) else { continue };
            if street.is_empty() || number.is_empty() { continue; }
            let label = format!("{street} {number}");
            entries.push(Entry { street: false, id: h.key[2..].to_string(), norm: query::fold(&label), label, detail: "Haus".to_string() });
        }
        entries
    }

    /// Street and address search: `(kind, id, label, detail)` of the best matches.
    pub fn search(&mut self, text: &str, limit: usize) -> Vec<(bool, String, String, String)> {
        if self.search_entries.is_none() { self.search_entries = Some(self.build_search()); }
        let entries = self.search_entries.as_ref().unwrap();
        query::search(entries, text, limit).into_iter().map(|i| { let e = &entries[i]; (e.street, e.id.clone(), e.label.clone(), e.detail.clone()) }).collect()
    }

    /// Route between street pieces (ids), through every anchor in order.
    pub fn route(&self, anchors: &[String]) -> RouteOut { self.graph.route(anchors) }

    /// The nearest house within `house_reach` metres, else the nearest street within `street_reach` (position, name).
    /// Returns (position, address, kind) with kind 0 = nothing, 1 = house, 2 = street.
    pub fn snap(&self, at: LngLat, house_reach: f64, street_reach: f64) -> (LngLat, Option<String>, u8) {
        let kx = 111_320.0 * (at[1] * std::f64::consts::PI / 180.0).cos();
        let m_lat = 110_574.0;
        let d2 = |p: LngLat| ((p[0] - at[0]) * kx).powi(2) + ((p[1] - at[1]) * m_lat).powi(2);
        let mut best_house: Option<(f64, usize)> = None;
        for (i, h) in self.houses.iter().enumerate() {
            if ((h.center_ll[0] - at[0]) * kx).abs() > house_reach || ((h.center_ll[1] - at[1]) * m_lat).abs() > house_reach { continue; }
            let d = d2(h.center_ll);
            if d <= house_reach * house_reach && best_house.map_or(true, |(bd, _)| d < bd) { best_house = Some((d, i)); }
        }
        if let Some((_, i)) = best_house {
            let h = &self.houses[i];
            let label: Vec<&str> = [h.street.as_deref(), h.number.as_deref()].into_iter().flatten().filter(|s| !s.is_empty()).collect();
            return (h.center_ll, if label.is_empty() { None } else { Some(label.join(" ")) }, 1);
        }
        let mut best: Option<(f64, LngLat, Option<String>)> = None;
        for s in &self.segs {
            for w in s.lnglat.windows(2) {
                let (a, b) = (w[0], w[1]);
                let (ax, ay, bx, by) = ((a[0] - at[0]) * kx, (a[1] - at[1]) * m_lat, (b[0] - at[0]) * kx, (b[1] - at[1]) * m_lat);
                let (dx, dy) = (bx - ax, by - ay);
                let len2 = dx * dx + dy * dy;
                let t = if len2 == 0.0 { 0.0 } else { (-(ax * dx + ay * dy) / len2).clamp(0.0, 1.0) };
                let (px, py) = (ax + t * dx, ay + t * dy);
                let d = px * px + py * py;
                if d <= street_reach * street_reach && best.as_ref().map_or(true, |(bd, _, _)| d < *bd) {
                    best = Some((d, [at[0] + px / kx, at[1] + py / m_lat], s.name.clone()));
                }
            }
        }
        match best { Some((_, p, name)) => (p, name, 2), None => (at, None, 0) }
    }

}
