//! Step 4: a spatial index over the segments (metres in the global frame) with each segment's normalised street name.
use super::*;

pub(super) struct Indexed {
    pub(super) seg: usize,
    pub(super) xy: Vec<[f64; 2]>,
    pub(super) norm: String,
}

pub(super) fn index_segments(segments: &[Segment], frame: &Frame) -> (Grid, Vec<Indexed>) {
    // 4. spatial index over segments (metres in the global frame)
    let mut seg_grid = Grid::new(64.0);
    let mut indexed: Vec<Indexed> = Vec::with_capacity(segments.len());
    for (seg_i, s) in segments.iter().enumerate() {
        let xy: Vec<[f64; 2]> = s.coords.iter().map(|p| frame.to_xy(*p)).collect();
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &xy {
            if p[0] < min_x {
                min_x = p[0];
            }
            if p[0] > max_x {
                max_x = p[0];
            }
            if p[1] < min_y {
                min_y = p[1];
            }
            if p[1] > max_y {
                max_y = p[1];
            }
        }
        let gid = seg_grid.insert([min_x, min_y, max_x, max_y]);
        debug_assert_eq!(gid as usize, indexed.len());
        indexed.push(Indexed { seg: seg_i, xy, norm: normalize_name(s.name.as_deref()) });
    }
    (seg_grid, indexed)
}
