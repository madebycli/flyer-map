//! A local flat projection in metres around a centre (equirectangular, the same constants as the engine).
use crate::LngLat;

const M_PER_DEG_LAT: f64 = 110_574.0;
const M_PER_DEG_LNG_EQ: f64 = 111_320.0;

#[derive(Clone, Copy, Debug)]
pub struct Frame {
    lng0: f64,
    lat0: f64,
    cos_lat: f64,
}

impl Frame {
    /// Centred on the middle of everything given.
    pub fn around<'a>(points: impl IntoIterator<Item = &'a LngLat>) -> Frame {
        let (mut w, mut s, mut e, mut n) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in points {
            w = w.min(p[0]);
            e = e.max(p[0]);
            s = s.min(p[1]);
            n = n.max(p[1]);
        }
        let (lng0, lat0) = if w.is_finite() { ((w + e) / 2.0, (s + n) / 2.0) } else { (0.0, 0.0) };
        Frame { lng0, lat0, cos_lat: lat0.to_radians().cos() }
    }

    pub fn xy(&self, p: LngLat) -> [f64; 2] {
        [(p[0] - self.lng0) * self.cos_lat * M_PER_DEG_LNG_EQ, (p[1] - self.lat0) * M_PER_DEG_LAT]
    }
}
