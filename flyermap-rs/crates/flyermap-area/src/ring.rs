//! Ring helpers in projected metres: orientation, area, point in ring, segment crossing.
use crate::{frame::Frame, LngLat, Ring};

/// The ring without the repeated last point.
pub fn open(ring: &[LngLat]) -> Vec<LngLat> {
    let mut out = ring.to_vec();
    if out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    out
}

/// The ring with the first point repeated at the end.
pub fn close(points: &[LngLat]) -> Ring {
    let mut out = points.to_vec();
    if let Some(first) = out.first().copied() {
        if out.last() != Some(&first) {
            out.push(first);
        }
    }
    out
}

/// Signed area in m² of an open ring (positive: counter-clockwise).
pub fn signed_area(frame: &Frame, points: &[LngLat]) -> f64 {
    let xy: Vec<[f64; 2]> = points.iter().map(|p| frame.xy(*p)).collect();
    let n = xy.len();
    (0..n).map(|i| xy[i][0] * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * xy[i][1]).sum::<f64>() / 2.0
}

/// Area in m² of a ring (open or closed), in a projection centred on the ring (accurate to about 1e-4 for a town-sized Gebiet).
pub fn area_m2(ring: &[LngLat]) -> f64 {
    let points = open(ring);
    signed_area(&Frame::around(&points), &points).abs()
}

/// Counter-clockwise (the GeoJSON recommendation for outer rings).
pub fn ccw(frame: &Frame, mut points: Vec<LngLat>) -> Vec<LngLat> {
    if signed_area(frame, &points) < 0.0 {
        points.reverse();
    }
    points
}

/// Ray casting on an open ring in projected coordinates.
pub fn contains(frame: &Frame, points: &[LngLat], p: LngLat) -> bool {
    let q = frame.xy(p);
    let xy: Vec<[f64; 2]> = points.iter().map(|p| frame.xy(*p)).collect();
    let mut inside = false;
    let mut j = xy.len().wrapping_sub(1);
    for i in 0..xy.len() {
        let (a, b) = (xy[i], xy[j]);
        if (a[1] > q[1]) != (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn orient(p: [f64; 2], q: [f64; 2], r: [f64; 2]) -> f64 {
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
}

/// Do the segments cross in their interiors (touching at an end point does not count; collinear overlap does)?
pub fn crosses(frame: &Frame, a: LngLat, b: LngLat, c: LngLat, d: LngLat) -> bool {
    let (a, b, c, d) = (frame.xy(a), frame.xy(b), frame.xy(c), frame.xy(d));
    const EPS: f64 = 1e-6; // a micrometre: end points on the other segment count as touching
    let (d1, d2, d3, d4) = (orient(c, d, a), orient(c, d, b), orient(a, b, c), orient(a, b, d));
    if ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS)) {
        return true;
    }
    // collinear overlap longer than a touch
    if d1.abs() <= EPS && d2.abs() <= EPS {
        let along = |p: [f64; 2]| (p[0] - c[0]) * (d[0] - c[0]) + (p[1] - c[1]) * (d[1] - c[1]);
        let len2 = along(d);
        let (s, t) = (along(a) / len2, along(b) / len2);
        let (lo, hi) = (s.min(t), s.max(t));
        return len2 > 0.0 && hi > EPS && lo < 1.0 - EPS && (hi.min(1.0) - lo.max(0.0)) > EPS;
    }
    false
}

/// The edges of an open ring as point pairs.
pub fn edges(points: &[LngLat]) -> impl Iterator<Item = (LngLat, LngLat)> + '_ {
    (0..points.len()).map(move |i| (points[i], points[(i + 1) % points.len()]))
}

/// Do the segments cross properly (each passes through the other's interior)? Shared or collinear borders do not count.
pub fn crosses_properly(frame: &Frame, a: LngLat, b: LngLat, c: LngLat, d: LngLat) -> bool {
    let (a, b, c, d) = (frame.xy(a), frame.xy(b), frame.xy(c), frame.xy(d));
    const EPS: f64 = 1e-6;
    let (d1, d2, d3, d4) = (orient(c, d, a), orient(c, d, b), orient(a, b, c), orient(a, b, d));
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
}

/// Distance in metres from `p` to the segment `a`–`b`, and where along it (0 at `a`, 1 at `b`).
pub fn to_segment(frame: &Frame, p: LngLat, a: LngLat, b: LngLat) -> (f64, f64) {
    let (p, a, b) = (frame.xy(p), frame.xy(a), frame.xy(b));
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0) };
    ((p[0] - (a[0] + t * dx)).hypot(p[1] - (a[1] + t * dy)), t)
}

/// Inside and not on the border (more than a centimetre away), so shared corners and edges do not count.
pub fn strictly_inside(frame: &Frame, points: &[LngLat], p: LngLat) -> bool {
    contains(frame, points, p) && edges(points).all(|(a, b)| to_segment(frame, p, a, b).0 > 0.01)
}

/// Consecutive equal points removed (also across the end).
pub fn dedupe(points: Vec<LngLat>) -> Vec<LngLat> {
    let mut out: Vec<LngLat> = Vec::with_capacity(points.len());
    for p in points {
        if out.last() != Some(&p) {
            out.push(p);
        }
    }
    while out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    out
}

/// The centroid of an open ring (lng/lat), used as an inside point for overlap tests of convex-ish shapes.
pub fn centroid(points: &[LngLat]) -> LngLat {
    let n = points.len().max(1) as f64;
    let (x, y) = points.iter().fold((0.0, 0.0), |s, p| (s.0 + p[0], s.1 + p[1]));
    [x / n, y / n]
}
