//! The two ways round: a stroke from one border point to another closes either way along the border.
use crate::{
    frame::Frame,
    ring::{contains, crosses_properly, dedupe, edges},
    snap::BorderPoint,
    LngLat,
};

/// Corner indices strictly between `from` and `to` going forward round a ring of `n` corners (all of them when `from == to`).
fn forward(n: usize, from: f64, to: f64) -> Vec<usize> {
    let to = if to <= from { to + n as f64 } else { to };
    let mut out = Vec::new();
    let mut k = from.floor() as usize + 1;
    while (k as f64) < to {
        out.push(k % n);
        k += 1;
    }
    out
}

/// The two closed shapes made by the stroke `start → path → end` and the border back to the start, forwards and backwards (open rings).
pub fn candidates(points: &[LngLat], start: &BorderPoint, path: &[LngLat], end: &BorderPoint) -> (Vec<LngLat>, Vec<LngLat>) {
    let n = points.len();
    let (a, b) = (start.position(points), end.position(points));
    let stroke: Vec<LngLat> = std::iter::once(a).chain(path.iter().copied()).chain(std::iter::once(b)).collect();
    let ahead: Vec<LngLat> = forward(n, end.along(), start.along()).into_iter().map(|i| points[i]).collect();
    let behind: Vec<LngLat> = forward(n, start.along(), end.along()).into_iter().rev().map(|i| points[i]).collect();
    (dedupe([stroke.clone(), ahead].concat()), dedupe([stroke, behind].concat()))
}

/// The ring with the given border points inserted as corners (points that are corners already are skipped).
pub fn with_inserted(points: &[LngLat], at: &[BorderPoint]) -> Vec<LngLat> {
    let mut order: Vec<&BorderPoint> = at.iter().filter(|p| !p.is_corner()).collect();
    order.sort_by(|x, y| y.along().total_cmp(&x.along()));
    order.dedup_by(|x, y| x.along() == y.along());
    let mut out = points.to_vec();
    for p in order {
        out.insert(p.edge + 1, p.position(points));
    }
    out
}

/// Where the stroke runs relative to a ring: `Some(true)` inside, `Some(false)` outside, `None` across the border.
pub fn side(frame: &Frame, points: &[LngLat], stroke: &[LngLat]) -> Option<bool> {
    let segments: Vec<(LngLat, LngLat)> = stroke.windows(2).map(|w| (w[0], w[1])).collect();
    if segments.iter().any(|(p, q)| edges(points).any(|(a, b)| crosses_properly(frame, *p, *q, a, b))) {
        return None;
    }
    // every corner of the stroke and the middle of every segment on the same side
    let probes: Vec<LngLat> =
        stroke[1..stroke.len() - 1].iter().copied().chain(segments.iter().map(|(p, q)| [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0])).collect();
    let inside: Vec<bool> = probes.iter().map(|p| contains(frame, points, *p)).collect();
    if inside.iter().all(|i| *i) {
        Some(true)
    } else if inside.iter().all(|i| !*i) {
        Some(false)
    } else {
        None
    }
}
