//! `restrictToArea`, ported from `src/v5/engine/area.ts`.
use crate::geo::point_in_ring;
use crate::model::*;
use rustc_hash::FxHashMap as HashMap;

fn orient(p: LngLat, q: LngLat, r: LngLat) -> i32 {
    let v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if v > 0.0 { 1 } else if v < 0.0 { -1 } else { 0 }
}

fn intersects(a: LngLat, b: LngLat, c: LngLat, d: LngLat) -> bool {
    orient(a, b, c) != orient(a, b, d) && orient(c, d, a) != orient(c, d, b)
}

fn crosses_ring(line: &[LngLat], ring: &[LngLat]) -> bool {
    for i in 1..line.len() {
        for j in 1..ring.len() {
            if intersects(line[i - 1], line[i], ring[j - 1], ring[j]) {
                return true;
            }
        }
    }
    false
}

pub fn restrict_to_area(network: Network, ring: &[LngLat]) -> Network {
    let houses: Vec<House> = network.houses.into_iter().filter(|h| point_in_ring(h.center, ring)).collect();
    let mut counts: HashMap<&str, u32> = HashMap::default();
    for h in &houses {
        if let Some(p) = &h.parent {
            *counts.entry(p.as_str()).or_insert(0) += 1;
        }
    }
    let kept: Vec<Segment> = network.segments.into_iter()
        .filter(|s| counts.contains_key(s.id.as_str()) || s.coords.iter().any(|p| point_in_ring(*p, ring)) || crosses_ring(&s.coords, ring))
        .collect();
    let mut group_houses: HashMap<String, u32> = HashMap::default();
    for s in &kept {
        *group_houses.entry(s.group.clone()).or_insert(0) += counts.get(s.id.as_str()).copied().unwrap_or(0);
    }
    let segments: Vec<Segment> = kept.into_iter().map(|mut s| {
        s.house_count = counts.get(s.id.as_str()).copied().unwrap_or(0);
        s.visible = s.cls == RoadClass::Street || group_houses.get(&s.group).copied().unwrap_or(0) > 0;
        s
    }).collect();
    let mut diagnostics = network.diagnostics;
    diagnostics.segments = segments.len();
    diagnostics.visible_segments = segments.iter().filter(|s| s.visible).count();
    diagnostics.houses_out = houses.len();
    Network { segments, houses, diagnostics }
}
