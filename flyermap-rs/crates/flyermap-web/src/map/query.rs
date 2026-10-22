//! What is under a finger on the field map: a tap's house or street piece, everything a brush stroke passes, screen points to positions,
//! and the camera moves the screens ask for.
use super::{
    bridge,
    field_map::FieldMap,
    hit::{self, P2},
    style,
};
use crate::engine::LngLat;
use std::collections::BTreeSet;

/// How far from a street line (px) a tap still counts for the street: in Strecke mode it beats a house, otherwise it is the fallback after houses.
const STREET_HALO_FIRST: f64 = 14.0;
const STREET_HALO: f64 = 16.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tapped {
    House(String),
    Segment(String),
}

#[derive(Default, Debug)]
pub struct Touched {
    pub houses: BTreeSet<String>,
    pub segments: BTreeSet<String>,
}

impl FieldMap {
    fn drawn(&self, x0: f64, y0: f64, x1: f64, y1: f64, layers: &[&str]) -> Vec<hit::Drawn> {
        hit::parse(&bridge::query(&self.0.map, x0, y0, x1, y1, &layers.join(",")))
    }

    /// A house is hit only when the tap lies inside it; streets get a forgiving halo. With `streets_first` (Strecke) a street close to the
    /// tap wins over the house the tap is in.
    pub fn tapped(&self, p: P2, streets_first: bool) -> Option<Tapped> {
        let h = STREET_HALO.max(STREET_HALO_FIRST);
        let drawn = self.drawn(p[0] - h, p[1] - h, p[0] + h, p[1] + h, &[style::HOUSES_FILL, style::STREETS, style::PATHS]);
        if streets_first {
            if let Some(id) = hit::nearest_line(&drawn, p, STREET_HALO_FIRST) {
                return Some(Tapped::Segment(id));
            }
        }
        if let Some(id) = hit::house_at(&drawn, p) {
            return Some(Tapped::House(id));
        }
        hit::nearest_line(&drawn, p, STREET_HALO).map(Tapped::Segment)
    }

    /// Everything the thick line a–b (radius r px) touches: houses by their drawn outline (a dot when zoomed out), street pieces by their line.
    pub fn brush_touch(&self, a: P2, b: P2, r: f64, into: &mut Touched) {
        let drawn = self.drawn(a[0].min(b[0]) - r, a[1].min(b[1]) - r, a[0].max(b[0]) + r, a[1].max(b[1]) + r, &[
            style::HOUSES_FILL,
            style::HOUSES_DOTS,
            style::STREETS,
            style::PATHS,
        ]);
        for f in drawn.iter().filter(|f| hit::touches(f, a, b, r)) {
            if let Some(id) = f.id.strip_prefix("h:") {
                into.houses.insert(id.to_string());
            } else if let Some(id) = f.id.strip_prefix("s:") {
                into.segments.insert(id.to_string());
            }
        }
    }

    pub fn unproject(&self, p: P2) -> LngLat {
        let v = bridge::unproject(&self.0.map, p[0], p[1]).to_vec();
        [v.first().copied().unwrap_or(0.0), v.get(1).copied().unwrap_or(0.0)]
    }

    /// `[lng, lat, zoom, bearing, west, south, east, north]`.
    pub fn view(&self) -> Vec<f64> {
        bridge::view(&self.0.map).to_vec()
    }

    pub fn zoom_by(&self, delta: f64) {
        bridge::zoom_by(&self.0.map, delta);
    }

    pub fn fit(&self, bounds: [f64; 4], padding: f64) {
        if bounds.iter().all(|v| v.is_finite()) {
            bridge::fit_bounds(&self.0.map, bounds[0], bounds[1], bounds[2], bounds[3], padding);
        }
    }

    pub fn focus(&self, at: LngLat, zoom: f64) {
        let now = self.view().get(2).copied().unwrap_or(zoom);
        bridge::ease_to(&self.0.map, at[0], at[1], now.max(zoom));
    }

    pub fn set_double_tap_zoom(&self, on: bool) {
        bridge::double_click_zoom(&self.0.map, on);
    }

    pub fn set_pan(&self, on: bool) {
        bridge::drag_pan(&self.0.map, on);
    }

    pub fn container(&self) -> web_sys::HtmlElement {
        bridge::container(&self.0.map)
    }

    /// For the flows and the diagnostics: tiles held, layers, tile protocol counters (JSON).
    pub fn debug_counts(&self) -> String {
        bridge::debug_counts(&self.0.map)
    }
}

/// West, south, east, north of a ring.
pub fn bounds(ring: &[LngLat]) -> [f64; 4] {
    ring.iter().fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, p| [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])])
}
