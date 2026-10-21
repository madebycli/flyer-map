//! Vector tiles cut from the loaded Areas.
use super::*;
use crate::mvt::{encode_tile, GeomType, Layer};
use crate::tile::{clip_line, clip_ring, to_tile, BUFFER, EXTENT};

impl Session {
    /// MVT bytes for tile z/x/y; empty when there is nothing to draw (or the zoom is below the first level).
    pub fn tile(&mut self, z: u32, x: u32, y: u32) -> Vec<u8> {
        if !(MIN_TILE_ZOOM..=22).contains(&z) {
            return Vec::new();
        }
        let n = (1u64 << z) as f64;
        let pad = (BUFFER / EXTENT) / n;
        let q = [
            x as f64 / n - pad,
            y as f64 / n - pad,
            (x + 1) as f64 / n + pad,
            (y + 1) as f64 / n + pad,
        ];
        let mut ids: Vec<u32> = Vec::new();
        let mut segments = Layer::new("segments");
        if z >= SEGMENTS_FROM {
            self.seg_grid.search(q, &mut ids);
            ids.sort_unstable();
            for &i in &ids {
                let s = &self.segs[i as usize];
                let pts: Vec<[f64; 2]> = s.line.iter().map(|p| to_tile(*p, z, x, y)).collect();
                let parts = clip_line(&pts);
                if !parts.is_empty() {
                    let mut props = vec![
                        ("key", s.key.as_str()),
                        ("h", if s.with_houses { "1" } else { "0" }),
                        ("p", if s.path { "1" } else { "0" }),
                    ];
                    if let Some(st) = self.st(&s.key) {
                        props.push(("st", st));
                    }
                    segments.add(GeomType::Line, &props, &parts);
                }
            }
        }
        let mut taken: FxHashSet<(i32, i32)> = FxHashSet::default();
        let mut houses = Layer::new("houses");
        let mut centers = Layer::new("centers");
        self.house_grid.search(q, &mut ids);
        ids.sort_unstable();
        for &i in &ids {
            let h = &self.houses[i as usize];
            if z >= OUTLINES_FROM {
                let ring: Vec<[f64; 2]> = h.ring.iter().map(|p| to_tile(*p, z, x, y)).collect();
                if let Some(r) = clip_ring(&ring) {
                    let mut props = vec![("key", h.key.as_str()), ("num", h.num.as_str())];
                    if let Some(st) = self.st(&h.key) {
                        props.push(("st", st));
                    }
                    houses.add(GeomType::Polygon, &props, &[r]);
                }
            }
            if z <= CENTERS_UP_TO {
                let c = to_tile(h.center, z, x, y);
                if c[0] >= -BUFFER
                    && c[0] <= EXTENT + BUFFER
                    && c[1] >= -BUFFER
                    && c[1] <= EXTENT + BUFFER
                {
                    if z <= THIN_DOTS_UP_TO
                        && !taken.insert((
                            (c[0] / DOT_CELL).floor() as i32,
                            (c[1] / DOT_CELL).floor() as i32,
                        ))
                    {
                        continue;
                    }
                    let mut props = vec![("key", h.key.as_str())];
                    if let Some(st) = self.st(&h.key) {
                        props.push(("st", st));
                    }
                    centers.add(
                        GeomType::Point,
                        &props,
                        &[vec![[c[0].round() as i32, c[1].round() as i32]]],
                    );
                }
            }
        }
        encode_tile(&[segments, houses, centers])
    }
}
