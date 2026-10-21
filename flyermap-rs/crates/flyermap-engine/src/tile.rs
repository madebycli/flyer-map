//! Web-Mercator tile geometry: projection, clipping to a tile (with buffer) and quantisation to the 4096 grid.
use crate::model::LngLat;

pub const EXTENT: f64 = 4096.0;
pub const BUFFER: f64 = 64.0;

/// lng/lat → normalised Web-Mercator (0..1, y down).
pub fn mercator(p: LngLat) -> [f64; 2] {
    let lat = p[1].clamp(-85.0511287798, 85.0511287798);
    let s = (lat * std::f64::consts::PI / 180.0).sin();
    [(p[0] + 180.0) / 360.0, 0.5 - ((1.0 + s) / (1.0 - s)).ln() / (4.0 * std::f64::consts::PI)]
}

/// Normalised mercator → tile units of tile (z, x, y).
pub fn to_tile(m: [f64; 2], z: u32, x: u32, y: u32) -> [f64; 2] {
    let n = (1u64 << z) as f64;
    [(m[0] * n - x as f64) * EXTENT, (m[1] * n - y as f64) * EXTENT]
}

const MIN: f64 = -BUFFER;
const MAX: f64 = EXTENT + BUFFER;

/// Liang–Barsky: the part of segment a→b inside the buffered tile, if any.
fn clip_segment(a: [f64; 2], b: [f64; 2]) -> Option<([f64; 2], [f64; 2])> {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for (p, q) in [(-dx, a[0] - MIN), (dx, MAX - a[0]), (-dy, a[1] - MIN), (dy, MAX - a[1])] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let r = q / p;
            if p < 0.0 {
                if r > t1 { return None; }
                if r > t0 { t0 = r; }
            } else {
                if r < t0 { return None; }
                if r < t1 { t1 = r; }
            }
        }
    }
    Some(([a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]))
}

fn quantise(p: [f64; 2]) -> [i32; 2] {
    [p[0].round() as i32, p[1].round() as i32]
}

/// A polyline in tile units → pieces inside the buffered tile, quantised, consecutive duplicates removed.
pub fn clip_line(line: &[[f64; 2]]) -> Vec<Vec<[i32; 2]>> {
    let mut pieces: Vec<Vec<[f64; 2]>> = Vec::new();
    for w in line.windows(2) {
        if let Some((a, b)) = clip_segment(w[0], w[1]) {
            match pieces.last_mut() {
                Some(cur) if cur.last() == Some(&a) => cur.push(b),
                _ => pieces.push(vec![a, b]),
            }
        }
    }
    pieces
        .into_iter()
        .filter_map(|piece| {
            let mut q: Vec<[i32; 2]> = Vec::with_capacity(piece.len());
            for p in piece {
                let p = quantise(p);
                if q.last() != Some(&p) {
                    q.push(p);
                }
            }
            if q.len() >= 2 { Some(q) } else { None }
        })
        .collect()
}

fn clip_edge(poly: Vec<[f64; 2]>, inside: impl Fn([f64; 2]) -> bool, cut: impl Fn([f64; 2], [f64; 2]) -> [f64; 2]) -> Vec<[f64; 2]> {
    let mut out = Vec::with_capacity(poly.len() + 4);
    for i in 0..poly.len() {
        let (cur, prev) = (poly[i], poly[(i + poly.len() - 1) % poly.len()]);
        match (inside(cur), inside(prev)) {
            (true, true) => out.push(cur),
            (true, false) => { out.push(cut(prev, cur)); out.push(cur); }
            (false, true) => out.push(cut(prev, cur)),
            (false, false) => {}
        }
    }
    out
}

/// Sutherland–Hodgman against the buffered tile; the ring is open (no repeated first point). Result is quantised and
/// oriented as an MVT exterior ring (positive shoelace sum in tile space).
pub fn clip_ring(ring: &[[f64; 2]]) -> Option<Vec<[i32; 2]>> {
    let mut poly: Vec<[f64; 2]> = ring.to_vec();
    if poly.first() == poly.last() && poly.len() > 1 { poly.pop(); }
    let (all_in, any_in) = poly.iter().fold((true, false), |(a, o), p| {
        let inside = p[0] >= MIN && p[0] <= MAX && p[1] >= MIN && p[1] <= MAX;
        (a && inside, o || inside)
    });
    if !all_in {
        let (min_x, max_x) = poly.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
        let (min_y, max_y) = poly.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| (lo.min(p[1]), hi.max(p[1])));
        if !any_in && (max_x < MIN || min_x > MAX || max_y < MIN || min_y > MAX) { return None; }
        poly = clip_edge(poly, |p| p[0] >= MIN, |a, b| { let t = (MIN - a[0]) / (b[0] - a[0]); [MIN, a[1] + t * (b[1] - a[1])] });
        poly = clip_edge(poly, |p| p[0] <= MAX, |a, b| { let t = (MAX - a[0]) / (b[0] - a[0]); [MAX, a[1] + t * (b[1] - a[1])] });
        poly = clip_edge(poly, |p| p[1] >= MIN, |a, b| { let t = (MIN - a[1]) / (b[1] - a[1]); [a[0] + t * (b[0] - a[0]), MIN] });
        poly = clip_edge(poly, |p| p[1] <= MAX, |a, b| { let t = (MAX - a[1]) / (b[1] - a[1]); [a[0] + t * (b[0] - a[0]), MAX] });
        if poly.len() < 3 { return None; }
    }
    let mut q: Vec<[i32; 2]> = Vec::with_capacity(poly.len());
    for p in poly {
        let p = quantise(p);
        if q.last() != Some(&p) { q.push(p); }
    }
    while q.len() > 1 && q.first() == q.last() { q.pop(); }
    if q.len() < 3 { return None; }
    let area: i64 = (0..q.len()).map(|i| { let (a, b) = (q[i], q[(i + 1) % q.len()]); a[0] as i64 * b[1] as i64 - b[0] as i64 * a[1] as i64 }).sum();
    if area == 0 { return None; }
    if area < 0 { q.reverse(); }
    Some(q)
}
