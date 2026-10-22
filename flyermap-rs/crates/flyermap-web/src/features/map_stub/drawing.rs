//! The stand-in for the map until the MapLibre bridge is wired (step 2): the Gebiete as outlines on a calm grid, so the zones have something
//! to float over. Pure: rings in, SVG point lists out.
use crate::model::{Gebiet, LngLat};

/// The drawing's coordinate box (`viewBox`), scaled to cover the screen.
pub const SIZE: f64 = 1000.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Shape {
    pub id: String,
    pub color: String,
    /// `x,y x,y …` in the box.
    pub points: String,
}

/// Fit all Gebiete into the box with a margin, north up, one scale for both axes (longitude is stretched by the latitude's cosine).
pub fn shapes(gebiete: &[Gebiet]) -> Vec<Shape> {
    let all: Vec<LngLat> = gebiete.iter().flat_map(|g| g.ring.iter().copied()).collect();
    let Some(b) = crate::model::ring_bounds(&all) else { return Vec::new() };
    let cos = ((b[1] + b[3]) / 2.0).to_radians().cos();
    let (w, h) = ((b[2] - b[0]) * cos, b[3] - b[1]);
    let scale = (SIZE * 0.7) / w.max(h).max(1e-9);
    let (ox, oy) = ((SIZE - w * scale) / 2.0, (SIZE - h * scale) / 2.0);
    gebiete
        .iter()
        .map(|g| Shape {
            id: g.id.clone(),
            color: g.color.clone(),
            points: g.ring.iter().map(|p| format!("{:.1},{:.1}", ox + (p[0] - b[0]) * cos * scale, oy + (b[3] - p[1]) * scale)).collect::<Vec<_>>().join(" "),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    #[test]
    fn every_gebiet_is_one_shape_inside_the_box() {
        let w = world(Persona::Admin);
        let s = shapes(&w.gebiete);
        assert_eq!(s.len(), 4);
        for shape in &s {
            for pair in shape.points.split(' ') {
                let (x, y) = pair.split_once(',').unwrap();
                let (x, y): (f64, f64) = (x.parse().unwrap(), y.parse().unwrap());
                assert!((0.0..=SIZE).contains(&x) && (0.0..=SIZE).contains(&y), "{pair}");
            }
        }
        assert!(shapes(&[]).is_empty());
    }
}
