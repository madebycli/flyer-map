//! Geometry helpers; same formulas, same evaluation order as `src/v5/engine/geo.ts` so results agree to the last digits.
use crate::model::LngLat;

const M_PER_DEG_LAT: f64 = 110_574.0;
const M_PER_DEG_LNG_EQ: f64 = 111_320.0;

#[derive(Clone, Copy)]
pub struct Frame {
    pub lng0: f64,
    pub lat0: f64,
    pub cos_lat: f64,
}

impl Frame {
    pub fn new(lng0: f64, lat0: f64) -> Self {
        Frame { lng0, lat0, cos_lat: (lat0 * std::f64::consts::PI / 180.0).cos() }
    }
    #[inline]
    pub fn x(&self, lng: f64) -> f64 {
        (lng - self.lng0) * self.cos_lat * M_PER_DEG_LNG_EQ
    }
    #[inline]
    pub fn y(&self, lat: f64) -> f64 {
        (lat - self.lat0) * M_PER_DEG_LAT
    }
    #[inline]
    pub fn to_xy(&self, p: LngLat) -> [f64; 2] {
        [self.x(p[0]), self.y(p[1])]
    }
}

pub fn frame_for<'a>(points: impl Iterator<Item = &'a LngLat>) -> Frame {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in points {
        if p[0] < min_x { min_x = p[0]; }
        if p[0] > max_x { max_x = p[0]; }
        if p[1] < min_y { min_y = p[1]; }
        if p[1] > max_y { max_y = p[1]; }
    }
    if !min_x.is_finite() {
        return Frame::new(0.0, 0.0);
    }
    Frame::new((min_x + max_x) / 2.0, (min_y + max_y) / 2.0)
}

pub fn polyline_length(frame: &Frame, coords: &[LngLat]) -> f64 {
    let mut total = 0.0;
    for i in 1..coords.len() {
        total += (frame.x(coords[i][0]) - frame.x(coords[i - 1][0])).hypot(frame.y(coords[i][1]) - frame.y(coords[i - 1][1]));
    }
    total
}

pub struct Projection {
    pub distance: f64,
    pub measure: f64,
}

pub fn project_to_polyline(line: &[[f64; 2]], p: [f64; 2]) -> Projection {
    let (mut best, mut best_measure, mut walked) = (f64::INFINITY, 0.0, 0.0);
    for i in 1..line.len() {
        let (ax, ay, bx, by) = (line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
        let (dx, dy) = (bx - ax, by - ay);
        let len2 = dx * dx + dy * dy;
        let t = if len2 == 0.0 { 0.0 } else { (((p[0] - ax) * dx + (p[1] - ay) * dy) / len2).clamp(0.0, 1.0) };
        let d = (p[0] - (ax + t * dx)).hypot(p[1] - (ay + t * dy));
        let seg_len = len2.sqrt();
        if d < best {
            best = d;
            best_measure = walked + t * seg_len;
        }
        walked += seg_len;
    }
    Projection { distance: best, measure: best_measure }
}

pub fn ring_centroid(ring: &[LngLat]) -> LngLat {
    let (ox, oy) = (ring[0][0], ring[0][1]);
    let (mut a, mut cx, mut cy) = (0.0, 0.0, 0.0);
    for i in 0..ring.len() - 1 {
        let (x0, y0, x1, y1) = (ring[i][0] - ox, ring[i][1] - oy, ring[i + 1][0] - ox, ring[i + 1][1] - oy);
        let f = x0 * y1 - x1 * y0;
        a += f;
        cx += (x0 + x1) * f;
        cy += (y0 + y1) * f;
    }
    if a.abs() < 1e-18 {
        let n = (ring.len() - 1).max(1);
        let (sx, sy) = ring[..n].iter().fold((0.0, 0.0), |s, p| (s.0 + p[0], s.1 + p[1]));
        return [sx / n as f64, sy / n as f64];
    }
    [ox + cx / (3.0 * a), oy + cy / (3.0 * a)]
}

pub fn point_in_ring(p: LngLat, ring: &[LngLat]) -> bool {
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

/// JS `Number.prototype.toFixed(7)` as used for coordinate keys (never "-0.0000000" for an exact zero).
pub fn fixed7(v: f64) -> String {
    let v = if v == 0.0 { 0.0 } else { v };
    format!("{v:.7}")
}

pub fn coord_key(p: LngLat) -> String {
    format!("{},{}", fixed7(p[0]), fixed7(p[1]))
}

pub fn split_equal(frame: &Frame, coords: &[LngLat], parts: usize) -> Vec<Vec<LngLat>> {
    if parts <= 1 || coords.len() < 2 {
        return vec![coords.to_vec()];
    }
    let mut cum = vec![0.0];
    for i in 1..coords.len() {
        let step = (frame.x(coords[i][0]) - frame.x(coords[i - 1][0])).hypot(frame.y(coords[i][1]) - frame.y(coords[i - 1][1]));
        cum.push(cum[i - 1] + step);
    }
    let total = cum[cum.len() - 1];
    let at = |d: f64| -> LngLat {
        let mut i = 1;
        while i < cum.len() - 1 && cum[i] < d {
            i += 1;
        }
        let span = cum[i] - cum[i - 1];
        let t = if span == 0.0 { 0.0 } else { (d - cum[i - 1]) / span };
        [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]
    };
    let mut out = Vec::with_capacity(parts);
    for k in 0..parts {
        let from = (total * k as f64) / parts as f64;
        let to = (total * (k + 1) as f64) / parts as f64;
        let mut piece = vec![if k == 0 { coords[0] } else { at(from) }];
        for i in 1..coords.len() - 1 {
            if cum[i] > from + 1e-9 && cum[i] < to - 1e-9 {
                piece.push(coords[i]);
            }
        }
        piece.push(if k == parts - 1 { coords[coords.len() - 1] } else { at(to) });
        out.push(piece);
    }
    out
}
