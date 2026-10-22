//! Is an outline a valid Gebiet: at least three corners, not crossing itself, big enough, not over another Gebiet (shared borders are fine)?
use crate::{
    frame::Frame,
    ring::{centroid, crosses, crosses_properly, dedupe, edges, open, signed_area, strictly_inside},
    DrawError, LngLat, Ring,
};

/// Smaller than this is almost always a slip of the finger.
pub const MIN_AREA_M2: f64 = 100.0;

fn simple(frame: &Frame, points: &[LngLat]) -> bool {
    let n = points.len();
    let segment = |i: usize| (points[i], points[(i + 1) % n]);
    for i in 0..n {
        // neighbours meet in one corner; turning straight back onto the previous edge is a crossing too
        let (a, b, c) = (frame.xy(points[i]), frame.xy(points[(i + 1) % n]), frame.xy(points[(i + 2) % n]));
        let (u, v) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
        if (u[0] * v[1] - u[1] * v[0]).abs() < 1e-6 && u[0] * v[0] + u[1] * v[1] < 0.0 {
            return false;
        }
        for j in i + 2..n {
            if i == 0 && j == n - 1 {
                continue;
            }
            let ((p, q), (r, s)) = (segment(i), segment(j));
            if crosses(frame, p, q, r, s) {
                return false;
            }
        }
    }
    true
}

/// Do the insides of two open rings overlap? Touching along a border or in a corner does not count.
pub(crate) fn overlaps(frame: &Frame, a: &[LngLat], b: &[LngLat]) -> bool {
    let crossing = edges(a).any(|(p, q)| edges(b).any(|(r, s)| crosses_properly(frame, p, q, r, s)));
    let midpoints = |ring: &[LngLat]| edges(ring).map(|(p, q)| [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0]).collect::<Vec<_>>();
    let inside = |outer: &[LngLat], probes: &[LngLat]| probes.iter().any(|p| strictly_inside(frame, outer, *p));
    crossing
        || inside(b, a)
        || inside(a, b)
        || inside(b, &midpoints(a))
        || inside(a, &midpoints(b))
        || (strictly_inside(frame, a, centroid(a)) && strictly_inside(frame, b, centroid(a)))
}

pub fn check(ring: &Ring, others: &[Ring]) -> Result<(), DrawError> {
    let points = dedupe(open(ring));
    if points.len() < 3 {
        return Err(DrawError::TooFewPoints);
    }
    let frame = Frame::around(&points);
    if !simple(&frame, &points) {
        return Err(DrawError::SelfCrossing);
    }
    if signed_area(&frame, &points).abs() < MIN_AREA_M2 {
        return Err(DrawError::TooSmall);
    }
    match others.iter().position(|o| overlaps(&frame, &points, &open(o))) {
        Some(i) => Err(DrawError::OverlapsArea(i)),
        None => Ok(()),
    }
}
