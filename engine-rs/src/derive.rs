//! `deriveNetwork`: a line-by-line port of `src/v5/engine/derive.ts` (same ids, same tie-breaks, same rounding).
use crate::classify::{classify_building, classify_road, BuildingVerdict};
use crate::geo::*;
use crate::grid::Grid;
use crate::model::*;
use rustc_hash::{FxHashMap as HashMap, FxHashSet as HashSet};
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

pub const ENGINE_VERSION: &str = "v5.2";
pub const CHUNK_METERS: f64 = 60.0;
const MAX_PARENT_DISTANCE: f64 = 45.0;
const MAX_NAMED_PARENT_DISTANCE: f64 = 80.0;
const ADDRESS_NODE_SNAP: f64 = 8.0;
const SCORE_EPS: f64 = 1e-9;

fn class_penalty(cls: RoadClass) -> f64 {
    match cls {
        RoadClass::Street => 0.0,
        RoadClass::Access => 8.0,
        RoadClass::Connector => 25.0,
    }
}

/// JS `String.prototype.trim` (White_Space plus the byte order mark).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

fn trimmed(tags: &Tags, key: &str) -> Option<String> {
    tags.get(key).map(|v| js_trim(v).to_string())
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

fn normalize_name(name: Option<&str>) -> String {
    let lowered: String = name.unwrap_or("").nfkc().collect::<String>().to_lowercase();
    let replaced = lowered.replace("straße", "str").replace("strasse", "str");
    let kept: String = replaced.chars().filter(|c| !(c.is_whitespace() || *c == '\u{FEFF}' || *c == '.' || *c == '-')).collect();
    js_trim(&kept).to_string()
}

fn vertex_key(way: &RawWay, index: usize) -> String {
    match way.nodes.as_ref().and_then(|n| n.get(index)) {
        Some(node) => format!("n{node}"),
        None => format!("c{}", coord_key(way.coords[index])),
    }
}

fn bump(map: &mut BTreeMap<String, u32>, key: String) {
    *map.entry(key).or_insert(0) += 1;
}

struct Indexed {
    seg: usize,
    xy: Vec<[f64; 2]>,
    norm: String,
}

pub fn derive_network(raw: &RawOsm) -> Network {
    let mut diag = Diagnostics {
        engine_version: ENGINE_VERSION.into(),
        ways_in: raw.ways.len(),
        buildings_in: raw.buildings.len(),
        ..Default::default()
    };
    let frame = frame_for(raw.ways.iter().flat_map(|w| w.coords.iter()).chain(raw.buildings.iter().flat_map(|b| b.ring.iter())).chain(raw.addresses.iter().map(|a| &a.point)));

    // 1. classify, keep candidates, stable order by way id
    let mut ways: Vec<(&RawWay, RoadClass)> = Vec::new();
    for way in &raw.ways {
        if way.coords.len() < 2 {
            bump(&mut diag.ways_excluded, "degenerate".into());
            continue;
        }
        match classify_road(&way.tags) {
            Ok(cls) => ways.push((way, cls)),
            Err(reason) => bump(&mut diag.ways_excluded, reason),
        }
    }
    ways.sort_by_key(|(w, _)| w.id);

    // 2. junctions: a vertex visited by >= 2 distinct (way, position) visits
    let mut visits: HashMap<String, u32> = HashMap::default();
    for (way, _) in &ways {
        for i in 0..way.coords.len() {
            *visits.entry(vertex_key(way, i)).or_insert(0) += 1;
        }
    }

    // 3. split at endpoints and junctions, then into chunks
    let mut segments: Vec<Segment> = Vec::new();
    let mut used_ids: HashSet<String> = HashSet::default();
    for (way, cls) in &ways {
        let mut start = 0usize;
        for i in 1..way.coords.len() {
            let last = i == way.coords.len() - 1;
            if !last && visits.get(&vertex_key(way, i)).copied().unwrap_or(0) < 2 {
                continue;
            }
            let coords = &way.coords[start..=i];
            let local = frame_for(coords.iter());
            let length = polyline_length(&local, coords);
            if length >= 0.5 {
                let start_key = match way.nodes.as_ref().and_then(|n| n.get(start)) {
                    Some(node) => format!("{}:{}", way.id, node),
                    None => format!("{}#{}", way.id, start),
                };
                let mut id = format!("s{start_key}");
                if used_ids.contains(&id) {
                    id = format!("{id}#{start}");
                }
                used_ids.insert(id.clone());
                let parts = ((length / CHUNK_METERS - 0.02).ceil().max(1.0)) as usize;
                let pieces = split_equal(&local, coords, parts);
                let from_key = vertex_key(way, start);
                let to_key = vertex_key(way, i);
                let name = non_empty(trimmed(&way.tags, "name"));
                let reference = non_empty(trimmed(&way.tags, "ref"));
                let highway = way.tags.get("highway").cloned().unwrap_or_default();
                for (k, piece) in pieces.into_iter().enumerate() {
                    segments.push(Segment {
                        id: if parts == 1 { id.clone() } else { format!("{id}~{k}") },
                        group: id.clone(),
                        chunk: k as u32,
                        chunks: parts as u32,
                        way_id: way.id,
                        name: name.clone(),
                        reference: reference.clone(),
                        highway: highway.clone(),
                        cls: *cls,
                        coords: piece,
                        length: length / parts as f64,
                        from: if k == 0 { from_key.clone() } else { format!("{id}@{k}") },
                        to: if k == parts - 1 { to_key.clone() } else { format!("{id}@{}", k + 1) },
                        house_count: 0,
                        visible: false,
                    });
                }
            }
            start = i;
        }
    }
    diag.segments = segments.len();

    // 4. spatial index over segments (metres in the global frame)
    let mut seg_grid = Grid::new(64.0);
    let mut indexed: Vec<Indexed> = Vec::with_capacity(segments.len());
    for (seg_i, s) in segments.iter().enumerate() {
        let xy: Vec<[f64; 2]> = s.coords.iter().map(|p| frame.to_xy(*p)).collect();
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &xy {
            if p[0] < min_x { min_x = p[0]; }
            if p[0] > max_x { max_x = p[0]; }
            if p[1] < min_y { min_y = p[1]; }
            if p[1] > max_y { max_y = p[1]; }
        }
        let gid = seg_grid.insert([min_x, min_y, max_x, max_y]);
        debug_assert_eq!(gid as usize, indexed.len());
        indexed.push(Indexed { seg: seg_i, xy, norm: normalize_name(s.name.as_deref()) });
    }

    // 5. houses
    let mut address_nodes: Vec<&RawAddressNode> = raw.addresses.iter().collect();
    address_nodes.sort_by_key(|a| a.id);
    let mut node_grid = Grid::new(64.0);
    let mut node_xy: Vec<[f64; 2]> = Vec::with_capacity(address_nodes.len());
    let mut node_used: Vec<bool> = vec![false; address_nodes.len()];
    for node in &address_nodes {
        let p = frame.to_xy(node.point);
        node_grid.insert([p[0], p[1], p[0], p[1]]);
        node_xy.push(p);
    }

    let mut buildings: Vec<&RawBuilding> = raw.buildings.iter().collect();
    buildings.sort_by_key(|b| b.id);
    let mut houses: Vec<House> = Vec::new();
    let mut scratch: Vec<u32> = Vec::new();
    for building in &buildings {
        if building.ring.len() < 4 {
            bump(&mut diag.buildings_skipped, "degenerate_ring".into());
            continue;
        }
        let center = ring_centroid(&building.ring);
        let [cx, cy] = frame.to_xy(center);
        let mut number = non_empty(trimmed(&building.tags, "addr:housenumber"));
        let mut street = non_empty(trimmed(&building.tags, "addr:street"));
        if number.is_none() {
            node_grid.search([cx - 40.0, cy - 40.0, cx + 40.0, cy + 40.0], &mut scratch);
            let mut near: Vec<(f64, i64, usize)> = Vec::new();
            for &idx in &scratch {
                let i = idx as usize;
                let node = address_nodes[i];
                let d = (node_xy[i][0] - cx).hypot(node_xy[i][1] - cy);
                if point_in_ring(node.point, &building.ring) || d <= ADDRESS_NODE_SNAP {
                    near.push((d, node.id, i));
                }
            }
            near.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
            let hit = near.iter().find(|(_, _, i)| address_nodes[*i].tags.get("addr:housenumber").map(|v| !v.is_empty()).unwrap_or(false));
            if let Some(&(_, _, i)) = hit {
                node_used[i] = true;
                let node = address_nodes[i];
                number = Some(js_trim(&node.tags["addr:housenumber"]).to_string());
                // JS: `street ?? node street?.trim() ?? null` — a node street of "" stays "".
                if street.is_none() {
                    street = trimmed(&node.tags, "addr:street");
                }
            }
        }
        let evidence = match classify_building(&building.tags, number.is_some()) {
            BuildingVerdict::Keep(e) => e,
            BuildingVerdict::Drop(reason) => {
                bump(&mut diag.buildings_skipped, reason);
                continue;
            }
        };
        let house = House {
            id: format!("h{}", building.id), osm_id: building.id, source: "building", number, street, ring: building.ring.clone(), center,
            parent: None, measure: None, evidence,
        };
        houses.push(assign_parent(house, &frame, &mut seg_grid, &indexed, &segments, &mut scratch));
    }

    // address nodes that belong to no building become small point-houses
    let mut building_grid = Grid::new(0.001);
    for b in &raw.buildings {
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &b.ring {
            if p[0] < min_x { min_x = p[0]; }
            if p[0] > max_x { max_x = p[0]; }
            if p[1] < min_y { min_y = p[1]; }
            if p[1] > max_y { max_y = p[1]; }
        }
        if !min_x.is_finite() {
            // an empty ring has an infinite box in JS too and never matches
            building_grid.insert([f64::MAX, f64::MAX, f64::MAX, f64::MAX]);
        } else {
            building_grid.insert([min_x, min_y, max_x, max_y]);
        }
    }
    for (i, node) in address_nodes.iter().enumerate() {
        let has_number = node.tags.get("addr:housenumber").map(|v| !v.is_empty()).unwrap_or(false);
        if node_used[i] || !has_number {
            continue;
        }
        let [nx, ny] = node.point;
        building_grid.search([nx, ny, nx, ny], &mut scratch);
        if scratch.iter().any(|&b| point_in_ring(node.point, &raw.buildings[b as usize].ring)) {
            continue;
        }
        let d = 0.00003;
        let house = House {
            id: format!("a{}", node.id), osm_id: node.id, source: "address-node",
            number: Some(js_trim(&node.tags["addr:housenumber"]).to_string()),
            street: trimmed(&node.tags, "addr:street"),
            ring: vec![[nx - d, ny - d], [nx + d, ny - d], [nx + d, ny + d], [nx - d, ny + d], [nx - d, ny - d]],
            center: node.point, parent: None, measure: None, evidence: "address-node",
        };
        houses.push(assign_parent(house, &frame, &mut seg_grid, &indexed, &segments, &mut scratch));
    }

    // 6. visibility: streets always; access/connector only when real houses use them
    let index_of: HashMap<&str, usize> = segments.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();
    let mut counts = vec![0u32; segments.len()];
    for h in &houses {
        match &h.parent {
            None => diag.orphan_houses += 1,
            Some(p) => counts[index_of[p.as_str()]] += 1,
        }
    }
    for (i, c) in counts.iter().enumerate() {
        segments[i].house_count = *c;
    }
    let mut group_houses: HashMap<String, u32> = HashMap::default();
    for s in &segments {
        *group_houses.entry(s.group.clone()).or_insert(0) += s.house_count;
    }
    for s in segments.iter_mut() {
        s.visible = s.cls == RoadClass::Street || group_houses.get(&s.group).copied().unwrap_or(0) > 0;
        if s.visible {
            diag.visible_segments += 1;
            if s.cls != RoadClass::Street {
                diag.promoted_by_houses += 1;
            }
        } else if s.cls == RoadClass::Connector {
            diag.hidden_connectors += 1;
        }
    }
    diag.houses_out = houses.len();
    houses.sort_by(|a, b| a.id.cmp(&b.id));
    let mut network = Network { segments, houses, diagnostics: diag };
    round_network(&mut network);
    network
}

/// OSM stores 1e-7° (about 1 cm); derived points are rounded to the same grid, exactly as the TypeScript engine does.
fn r7(v: f64) -> f64 {
    (v * 1e7 + 0.5).floor() / 1e7
}

fn round_network(network: &mut Network) {
    for s in network.segments.iter_mut() {
        for p in s.coords.iter_mut() {
            *p = [r7(p[0]), r7(p[1])];
        }
    }
    for h in network.houses.iter_mut() {
        for p in h.ring.iter_mut() {
            *p = [r7(p[0]), r7(p[1])];
        }
        h.center = [r7(h.center[0]), r7(h.center[1])];
    }
}

fn assign_parent(mut house: House, frame: &Frame, grid: &mut Grid, indexed: &[Indexed], segments: &[Segment], scratch: &mut Vec<u32>) -> House {
    let [cx, cy] = frame.to_xy(house.center);
    let reach = MAX_NAMED_PARENT_DISTANCE;
    let wanted = normalize_name(house.street.as_deref());
    grid.search([cx - reach, cy - reach, cx + reach, cy + reach], scratch);
    let mut best: Option<(f64, usize, f64)> = None; // score, segment index, measure
    for &gid in scratch.iter() {
        let entry = &indexed[gid as usize];
        let seg = &segments[entry.seg];
        let named = !wanted.is_empty() && entry.norm == wanted;
        let limit = if named { MAX_NAMED_PARENT_DISTANCE } else { MAX_PARENT_DISTANCE };
        // The box distance never exceeds the true distance, so skipping beyond `limit` changes no outcome, only the work.
        let b = grid.bbox(gid);
        if (b[0] - cx).max(0.0).max(cx - b[2]).hypot((b[1] - cy).max(0.0).max(cy - b[3])) > limit {
            continue;
        }
        let projection = project_to_polyline(&entry.xy, [cx, cy]);
        if projection.distance > limit {
            continue;
        }
        let score = projection.distance + class_penalty(seg.cls) - if named { 30.0 } else { 0.0 };
        let better = match best {
            None => true,
            Some((bs, bi, _)) => score < bs - SCORE_EPS || ((score - bs).abs() <= SCORE_EPS && seg.id < segments[bi].id),
        };
        if better {
            best = Some((score, entry.seg, projection.measure));
        }
    }
    if let Some((_, si, measure)) = best {
        house.parent = Some(segments[si].id.clone());
        house.measure = Some((measure * 10.0 + 0.5).floor() / 10.0);
    }
    house
}
