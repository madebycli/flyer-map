//! Uniform grid for bounding-box queries. Returns exactly the entries whose box intersects the query box
//! (the same candidate set an R-tree gives), so callers see identical results regardless of the structure.
use rustc_hash::FxHashMap as HashMap;

pub struct Grid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<u32>>,
    boxes: Vec<[f64; 4]>,
    stamp: Vec<u32>,
    epoch: u32,
}

impl Grid {
    pub fn new(cell: f64) -> Self {
        Grid { cell, cells: HashMap::default(), boxes: Vec::new(), stamp: Vec::new(), epoch: 0 }
    }

    fn range(&self, b: &[f64; 4]) -> (i64, i64, i64, i64) {
        ((b[0] / self.cell).floor() as i64, (b[1] / self.cell).floor() as i64, (b[2] / self.cell).floor() as i64, (b[3] / self.cell).floor() as i64)
    }

    pub fn bbox(&self, id: u32) -> &[f64; 4] {
        &self.boxes[id as usize]
    }

    /// `[minX, minY, maxX, maxY]`; returns the entry index.
    pub fn insert(&mut self, b: [f64; 4]) -> u32 {
        let id = self.boxes.len() as u32;
        let (x0, y0, x1, y1) = self.range(&b);
        for x in x0..=x1 {
            for y in y0..=y1 {
                self.cells.entry((x, y)).or_default().push(id);
            }
        }
        self.boxes.push(b);
        self.stamp.push(0);
        id
    }

    pub fn search(&mut self, q: [f64; 4], out: &mut Vec<u32>) {
        out.clear();
        self.epoch = self.epoch.wrapping_add(1);
        let (x0, y0, x1, y1) = self.range(&q);
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(list) = self.cells.get(&(x, y)) {
                    for &id in list {
                        if self.stamp[id as usize] == self.epoch {
                            continue;
                        }
                        self.stamp[id as usize] = self.epoch;
                        let b = &self.boxes[id as usize];
                        if b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1] {
                            out.push(id);
                        }
                    }
                }
            }
        }
    }
}
