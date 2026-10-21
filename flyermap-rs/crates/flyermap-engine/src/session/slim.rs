//! The slim form of a network (what the interface keeps) and the small geometry helpers it needs.
use super::*;

pub(super) fn bbox(pts: &[[f64; 2]]) -> [f64; 4] {
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in pts {
        x0 = x0.min(p[0]);
        x1 = x1.max(p[0]);
        y0 = y0.min(p[1]);
        y1 = y1.max(p[1]);
    }
    [x0, y0, x1, y1]
}

/// Same rule as `midpointByLength` in legacy.ts (degrees, not metres — it only has to be stable and central).
pub fn midpoint_by_length(coords: &[LngLat]) -> Option<LngLat> {
    if coords.len() < 2 {
        return None;
    }
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
            let t = if lengths[i] == 0.0 {
                0.0
            } else {
                rest / lengths[i]
            };
            return Some([
                coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
                coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
            ]);
        }
        rest -= lengths[i];
    }
    None
}

pub(super) fn r7(v: f64) -> f64 {
    (v * 1e7 + 0.5).floor() / 1e7
}

pub fn slim(network: &Network) -> SlimNetwork {
    let segments = network
        .segments
        .iter()
        .map(|s| {
            let m = midpoint_by_length(&s.coords).unwrap_or(s.coords[0]);
            SlimSegment {
                id: s.id.clone(),
                group: s.group.clone(),
                chunk: s.chunk,
                chunks: s.chunks,
                way_id: s.way_id,
                name: s.name.clone(),
                reference: s.reference.clone(),
                highway: s.highway.clone(),
                cls: s.cls,
                length: s.length,
                from: s.from.clone(),
                to: s.to.clone(),
                house_count: s.house_count,
                visible: s.visible,
                mid: [r7(m[0]), r7(m[1])],
                start: s.coords[0],
            }
        })
        .collect();
    let houses = network
        .houses
        .iter()
        .map(|h| SlimHouse {
            id: h.id.clone(),
            osm_id: h.osm_id,
            source: h.source,
            number: h.number.clone(),
            street: h.street.clone(),
            center: h.center,
            parent: h.parent.clone(),
            measure: h.measure,
            street_parent: h.street_parent.clone(),
            evidence: h.evidence,
        })
        .collect();
    SlimNetwork {
        segments,
        houses,
        diagnostics: network.diagnostics.clone(),
    }
}
