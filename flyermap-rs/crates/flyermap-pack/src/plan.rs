//! Which map data to fetch for a Gebiet. A small Gebiet is one part (its outline plus a margin); a big one is cut along a fixed grid over the
//! map (the same for every Gebiet, so a part's contents never depend on the outline around it), and only the cells it touches are fetched.
use crate::js::to_fixed;
use serde::Serialize;

pub type LngLat = [f64; 2];
/// `[south, west, north, east]`
pub type Bbox = [f64; 4];
/// `[west, south, east, north]`
pub type Cell = [f64; 4];

pub const PACK_CELL_LNG: f64 = 0.03;
pub const PACK_CELL_LAT: f64 = 0.02;
pub const PACK_SINGLE_MAX_SQ_KM: f64 = 6.0;
/// About 2 800 km² at 51° N: far more than any single Gebiet asks for; the limit only stops a runaway outline.
pub const MAX_PACK_PARTS: usize = 600;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PackPart {
    pub index: usize,
    /// `None` for a one-part Gebiet.
    pub cell: Option<Cell>,
    /// What is asked from the data source: the cell (or outline) plus a margin.
    pub bbox: Bbox,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PackPlan {
    pub single: bool,
    #[serde(rename = "tooLarge")]
    pub too_large: bool,
    pub parts: Vec<PackPart>,
}

/// One request per part: roads (with node ids), buildings and address nodes inside the box.
pub fn overpass_query(bbox: &Bbox) -> String {
    let b = bbox.iter().map(|n| to_fixed(*n, 6)).collect::<Vec<_>>().join(",");
    format!("[out:json][timeout:60];(way[\"highway\"]({b});way[\"building\"]({b});node[\"addr:housenumber\"]({b}););out geom qt;")
}

fn radians(deg: f64) -> f64 {
    (deg * std::f64::consts::PI) / 180.0
}

/// The outline's box plus `meters` on every side.
pub fn padded_bbox(ring: &[LngLat], meters: f64) -> Bbox {
    let (mut s, mut w, mut n, mut e) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &[lng, lat] in ring {
        s = s.min(lat);
        n = n.max(lat);
        w = w.min(lng);
        e = e.max(lng);
    }
    let d_lat = meters / 110_574.0;
    let d_lng = meters / (111_320.0 * libm::cos(radians((s + n) / 2.0)));
    [s - d_lat, w - d_lng, n + d_lat, e + d_lng]
}

/// Size of the box the map data of a Gebiet is fetched for, in km².
fn square_km(ring: &[LngLat]) -> f64 {
    let b = padded_bbox(ring, 80.0);
    ((b[2] - b[0]) * 110.574) * ((b[3] - b[1]) * 111.32 * libm::cos(radians((b[0] + b[2]) / 2.0)))
}

fn orient(p: LngLat, q: LngLat, r: LngLat) -> i8 {
    let v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if v > 0.0 {
        1
    } else if v < 0.0 {
        -1
    } else {
        0
    }
}

fn crossing(a: LngLat, b: LngLat, c: LngLat, d: LngLat) -> bool {
    orient(a, b, c) != orient(a, b, d) && orient(c, d, a) != orient(c, d, b)
}

fn point_in_ring(p: LngLat, ring: &[LngLat]) -> bool {
    let mut inside = false;
    if ring.is_empty() {
        return false;
    }
    let mut j = ring.len() - 1;
    for i in 0..ring.len() {
        let (xi, yi, xj, yj) = (ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
        if (yi > p[1]) != (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Does the outline touch the cell (a vertex inside, a corner inside the outline, or an edge across)?
fn touches(ring: &[LngLat], [w, s, e, n]: Cell) -> bool {
    if ring.iter().any(|&[x, y]| x >= w && x < e && y >= s && y < n) {
        return true;
    }
    let corners = [[w, s], [e, s], [e, n], [w, n]];
    if corners.iter().any(|c| point_in_ring(*c, ring)) {
        return true;
    }
    (1..ring.len()).any(|i| (0..4).any(|j| crossing(ring[i - 1], ring[i], corners[j], corners[(j + 1) % 4])))
}

pub fn plan(ring: &[LngLat]) -> PackPlan {
    if square_km(ring) <= PACK_SINGLE_MAX_SQ_KM {
        return PackPlan { single: true, too_large: false, parts: vec![PackPart { index: 0, cell: None, bbox: padded_bbox(ring, 80.0) }] };
    }
    let (mut w, mut s, mut e, mut n) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &[x, y] in ring {
        if x < w {
            w = x;
        }
        if x > e {
            e = x;
        }
        if y < s {
            s = y;
        }
        if y > n {
            n = y;
        }
    }
    let (c0, c1) = ((w / PACK_CELL_LNG).floor() as i64, (e / PACK_CELL_LNG).floor() as i64);
    let (r0, r1) = ((s / PACK_CELL_LAT).floor() as i64, (n / PACK_CELL_LAT).floor() as i64);
    let too_large = PackPlan { single: false, too_large: true, parts: Vec::new() };
    if (c1 - c0 + 1).saturating_mul(r1 - r0 + 1) > (MAX_PACK_PARTS * 20) as i64 {
        return too_large;
    }
    let mut parts = Vec::new();
    for r in r0..=r1 {
        for c in c0..=c1 {
            let (c, r) = (c as f64, r as f64);
            let cell = [c * PACK_CELL_LNG, r * PACK_CELL_LAT, (c + 1.0) * PACK_CELL_LNG, (r + 1.0) * PACK_CELL_LAT];
            if touches(ring, cell) {
                parts.push(PackPart { index: parts.len(), cell: Some(cell), bbox: padded_bbox(&[[cell[0], cell[1]], [cell[2], cell[3]]], 80.0) });
            }
        }
    }
    if parts.len() > MAX_PACK_PARTS {
        return too_large;
    }
    PackPlan { single: false, too_large: false, parts }
}
