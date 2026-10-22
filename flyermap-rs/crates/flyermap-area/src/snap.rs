//! Where a finger lands on the existing borders: a corner when it is close to one, otherwise the nearest point on an edge.
use crate::{
    frame::Frame,
    ring::{open, to_segment},
    LngLat, Ring,
};

/// A point on the border of Gebiet `area`: on edge `edge` (from corner `edge` to the next) at `t` in [0, 1); `t == 0` is the corner itself.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BorderPoint {
    pub area: usize,
    pub edge: usize,
    pub t: f64,
}

impl BorderPoint {
    /// Interpolated in longitude/latitude, so the same point is inserted bit for bit into both Gebiete.
    pub fn position(&self, points: &[LngLat]) -> LngLat {
        let a = points[self.edge];
        let b = points[(self.edge + 1) % points.len()];
        if self.t == 0.0 {
            return a;
        }
        [a[0] + (b[0] - a[0]) * self.t, a[1] + (b[1] - a[1]) * self.t]
    }

    /// Position along the ring (corner index plus fraction), for ordering.
    pub(crate) fn along(&self) -> f64 {
        self.edge as f64 + self.t
    }

    pub fn is_corner(&self) -> bool {
        self.t == 0.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Snapped {
    /// Where the point ends up (on the border when `border` is set, else where it was).
    pub point: LngLat,
    pub border: Option<BorderPoint>,
    /// Distance in metres from the given point to the nearest border.
    pub distance_m: f64,
}

/// Snaps `p` to the nearest border within `reach_m`; to a corner when that corner is within `corner_m`.
pub fn snap(p: LngLat, areas: &[Ring], reach_m: f64, corner_m: f64) -> Snapped {
    let frame = Frame::around([&p]);
    let mut best: Option<(f64, usize, usize, f64)> = None;
    for (area, ring) in areas.iter().enumerate() {
        let points = open(ring);
        for edge in 0..points.len() {
            let (d, t) = to_segment(&frame, p, points[edge], points[(edge + 1) % points.len()]);
            if best.is_none_or(|b| d < b.0) {
                best = Some((d, area, edge, t));
            }
        }
    }
    let Some((distance_m, area, edge, t)) = best.filter(|b| b.0 <= reach_m) else {
        return Snapped { point: p, border: None, distance_m: best.map_or(f64::INFINITY, |b| b.0) };
    };
    let points = open(&areas[area]);
    let n = points.len();
    let (a, b) = (points[edge], points[(edge + 1) % n]);
    let len = {
        let (a, b) = (frame.xy(a), frame.xy(b));
        (b[0] - a[0]).hypot(b[1] - a[1])
    };
    let border = if t * len <= corner_m {
        BorderPoint { area, edge, t: 0.0 }
    } else if (1.0 - t) * len <= corner_m {
        BorderPoint { area, edge: (edge + 1) % n, t: 0.0 }
    } else {
        BorderPoint { area, edge, t }
    };
    Snapped { point: border.position(&points), border: Some(border), distance_m }
}
