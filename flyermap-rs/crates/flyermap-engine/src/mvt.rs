//! Minimal Mapbox Vector Tile (v2) writer: points, lines, polygons with string properties.
use rustc_hash::FxHashMap;

pub fn varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8 & 0x7f) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn key(out: &mut Vec<u8>, field: u32, wire: u8) {
    varint(out, ((field as u64) << 3) | wire as u64);
}

fn bytes_field(out: &mut Vec<u8>, field: u32, data: &[u8]) {
    key(out, field, 2);
    varint(out, data.len() as u64);
    out.extend_from_slice(data);
}

fn zigzag(v: i32) -> u32 {
    ((v << 1) ^ (v >> 31)) as u32
}

#[derive(Clone, Copy)]
pub enum GeomType {
    Point = 1,
    Line = 2,
    Polygon = 3,
}

pub struct Layer {
    name: String,
    keys: Vec<String>,
    key_index: FxHashMap<String, u32>,
    values: Vec<String>,
    value_index: FxHashMap<String, u32>,
    features: Vec<Vec<u8>>,
    cursor: [i32; 2],
}

impl Layer {
    pub fn new(name: &str) -> Self {
        Layer { name: name.into(), keys: vec![], key_index: FxHashMap::default(), values: vec![], value_index: FxHashMap::default(), features: vec![], cursor: [0, 0] }
    }

    pub fn is_empty(&self) -> bool {
        self.features.is_empty()
    }

    fn tag(&mut self, k: &str, v: &str) -> (u32, u32) {
        let ki = match self.key_index.get(k) {
            Some(i) => *i,
            None => {
                let i = self.keys.len() as u32;
                self.keys.push(k.into());
                self.key_index.insert(k.into(), i);
                i
            }
        };
        let vi = match self.value_index.get(v) {
            Some(i) => *i,
            None => {
                let i = self.values.len() as u32;
                self.values.push(v.into());
                self.value_index.insert(v.into(), i);
                i
            }
        };
        (ki, vi)
    }

    fn move_to(&mut self, geom: &mut Vec<u32>, p: [i32; 2]) {
        geom.push(1 | (1 << 3));
        geom.push(zigzag(p[0] - self.cursor[0]));
        geom.push(zigzag(p[1] - self.cursor[1]));
        self.cursor = p;
    }

    fn line_to(&mut self, geom: &mut Vec<u32>, pts: &[[i32; 2]]) {
        geom.push(2 | ((pts.len() as u32) << 3));
        for p in pts {
            geom.push(zigzag(p[0] - self.cursor[0]));
            geom.push(zigzag(p[1] - self.cursor[1]));
            self.cursor = *p;
        }
    }

    /// `parts`: lines (>= 2 points), or closed-by-command polygon rings (>= 3 points, first ring exterior), or points.
    pub fn add(&mut self, kind: GeomType, props: &[(&str, &str)], parts: &[Vec<[i32; 2]>]) {
        self.cursor = [0, 0];
        let mut geom: Vec<u32> = Vec::new();
        match kind {
            GeomType::Point => {
                let pts: Vec<[i32; 2]> = parts.iter().flat_map(|p| p.iter().copied()).collect();
                if pts.is_empty() {
                    return;
                }
                geom.push(1 | ((pts.len() as u32) << 3));
                for p in pts {
                    geom.push(zigzag(p[0] - self.cursor[0]));
                    geom.push(zigzag(p[1] - self.cursor[1]));
                    self.cursor = p;
                }
            }
            GeomType::Line | GeomType::Polygon => {
                for part in parts {
                    if part.len() < if matches!(kind, GeomType::Line) { 2 } else { 3 } {
                        continue;
                    }
                    self.move_to(&mut geom, part[0]);
                    self.line_to(&mut geom, &part[1..]);
                    if matches!(kind, GeomType::Polygon) {
                        geom.push(7 | (1 << 3));
                    }
                }
                if geom.is_empty() {
                    return;
                }
            }
        }
        let mut tags: Vec<u32> = Vec::with_capacity(props.len() * 2);
        for (k, v) in props {
            let (ki, vi) = self.tag(k, v);
            tags.push(ki);
            tags.push(vi);
        }
        let mut feature = Vec::new();
        let mut packed = Vec::new();
        for t in &tags {
            varint(&mut packed, *t as u64);
        }
        bytes_field(&mut feature, 2, &packed);
        key(&mut feature, 3, 0);
        varint(&mut feature, kind as u64);
        packed.clear();
        for g in &geom {
            varint(&mut packed, *g as u64);
        }
        bytes_field(&mut feature, 4, &packed);
        self.features.push(feature);
    }

    fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        key(&mut out, 15, 0);
        varint(&mut out, 2);
        bytes_field(&mut out, 1, self.name.as_bytes());
        for f in &self.features {
            bytes_field(&mut out, 2, f);
        }
        for k in &self.keys {
            bytes_field(&mut out, 3, k.as_bytes());
        }
        for v in &self.values {
            let mut value = Vec::new();
            bytes_field(&mut value, 1, v.as_bytes());
            bytes_field(&mut out, 4, &value);
        }
        key(&mut out, 5, 0);
        varint(&mut out, 4096);
        out
    }
}

pub fn encode_tile(layers: &[Layer]) -> Vec<u8> {
    let mut out = Vec::new();
    for layer in layers.iter().filter(|l| !l.is_empty()) {
        bytes_field(&mut out, 3, &layer.encode());
    }
    out
}
