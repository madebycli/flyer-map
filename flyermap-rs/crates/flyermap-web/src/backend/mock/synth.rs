//! A made-up neighbourhood as an Overpass answer: a street grid on a fixed lattice (shared node ids at the crossings), houses on both sides with
//! addresses, and one asphalt footway with three houses on it (drawn dashed on the map). Deterministic: the same box and salt give the same bytes.
//! The mock backend runs it through `flyermap_pack::normalize` and `encode`, so the browser takes exactly the path a real pack takes.
use serde_json::{json, Value};

/// The lattice is anchored here; any point on earth would do, nothing is real.
const ORIGIN: [f64; 2] = [13.0, 51.2];
const M_LAT: f64 = 110_574.0;
const M_LNG: f64 = 111_320.0;
/// Distance between two streets, in metres.
pub const BLOCK: f64 = 90.0;
const NAMES: [&str; 16] = [
    "Lindenweg",
    "Hauptstraße",
    "Am Markt",
    "Kirchgasse",
    "Schulstraße",
    "Rosenweg",
    "Birkenallee",
    "Gartenstraße",
    "Mühlenweg",
    "Bergstraße",
    "Eichenweg",
    "Wiesenpfad",
    "Tulpenstraße",
    "Uferweg",
    "Sonnenhang",
    "Akazienweg",
];

struct Frame {
    cos: f64,
}

impl Frame {
    fn at(&self, x: f64, y: f64) -> Value {
        json!({"lat": ORIGIN[1] + y / M_LAT, "lon": ORIGIN[0] + x / (self.cos * M_LNG)})
    }
    fn metres(&self, lng: f64, lat: f64) -> (f64, f64) {
        ((lng - ORIGIN[0]) * self.cos * M_LNG, (lat - ORIGIN[1]) * M_LAT)
    }
}

fn hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

struct Builder<'a> {
    frame: Frame,
    salt: u64,
    elements: Vec<Value>,
    houses: u64,
    ends: u64,
    names: &'a [&'a str],
}

impl Builder<'_> {
    fn lattice_node(i: i64, j: i64) -> i64 {
        1_000_000 + (i + 500) * 1000 + (j + 500)
    }

    fn end_node(&mut self) -> i64 {
        self.ends += 1;
        50_000_000 + (self.salt % 900) as i64 * 10_000 + self.ends as i64
    }

    fn name(&self, index: usize) -> &str {
        self.names[(self.salt as usize + index) % self.names.len()]
    }

    fn way(&mut self, local: u64, tags: Value, nodes: Vec<i64>, points: Vec<(f64, f64)>) {
        let id = 10_000_000 + (self.salt % 900) * 1_000 + local;
        let geometry: Vec<Value> = points.iter().map(|p| self.frame.at(p.0, p.1)).collect();
        self.elements.push(json!({"type": "way", "id": id, "tags": tags, "nodes": nodes, "geometry": geometry}));
    }

    fn house(&mut self, x: f64, y: f64, number: &str, street: &str) {
        self.houses += 1;
        let id = 500_000_000 + (self.salt % 900) * 10_000 + self.houses;
        let ring: Vec<Value> = [(x, y), (x + 12.0, y), (x + 12.0, y + 9.0), (x, y + 9.0), (x, y)].iter().map(|p| self.frame.at(p.0, p.1)).collect();
        self.elements
            .push(json!({"type": "way", "id": id, "tags": {"building": "house", "addr:housenumber": number, "addr:street": street}, "geometry": ring}));
    }
}

/// The Overpass answer for the box `[south, west, north, east]`.
pub fn overpass(bbox: [f64; 4], salt: &str) -> Value {
    let cos = (ORIGIN[1].to_radians()).cos();
    let frame = Frame { cos };
    let (x0, y0) = frame.metres(bbox[1], bbox[0]);
    let (x1, y1) = frame.metres(bbox[3], bbox[2]);
    let mut b = Builder { frame, salt: hash(salt), elements: Vec::new(), houses: 0, ends: 0, names: &NAMES };
    let lattice = |lo: f64, hi: f64| ((lo / BLOCK).ceil() as i64)..=((hi / BLOCK).floor() as i64);
    let (is, js) = (lattice(x0, x1), lattice(y0, y1));
    let xs: Vec<f64> = is.clone().map(|i| i as f64 * BLOCK).collect();
    let ys: Vec<f64> = js.clone().map(|j| j as f64 * BLOCK).collect();

    // streets: east-west lines (named by row), north-south lines (named by column)
    for (row, j) in js.clone().enumerate() {
        let y = j as f64 * BLOCK;
        let (first, last) = (b.end_node(), b.end_node());
        let mut nodes = vec![first];
        let mut points = vec![(x0, y)];
        for i in is.clone() {
            nodes.push(Builder::lattice_node(i, j));
            points.push((i as f64 * BLOCK, y));
        }
        nodes.push(last);
        points.push((x1, y));
        let name = b.name(row).to_string();
        b.way(row as u64, json!({"highway": "residential", "name": name}), nodes, points);
    }
    for (col, i) in is.clone().enumerate() {
        let x = i as f64 * BLOCK;
        let (first, last) = (b.end_node(), b.end_node());
        let mut nodes = vec![first];
        let mut points = vec![(x, y0)];
        for j in js.clone() {
            nodes.push(Builder::lattice_node(i, j));
            points.push((x, j as f64 * BLOCK));
        }
        nodes.push(last);
        points.push((x, y1));
        let name = b.name(8 + col).to_string();
        b.way(100 + col as u64, json!({"highway": "residential", "name": name}), nodes, points);
    }

    // houses on both sides of every street, away from the crossings
    for (row, y) in ys.iter().enumerate() {
        let street = b.name(row).to_string();
        let mut k = 0;
        let mut x = x0 + 12.0;
        while x + 12.0 < x1 {
            if xs.iter().all(|c| (x + 6.0 - c).abs() > 24.0) {
                k += 1;
                if y - 20.0 > y0 {
                    b.house(x, y - 20.0, &(k * 2 - 1).to_string(), &street);
                }
                if y + 11.0 + 9.0 < y1 {
                    b.house(x, y + 11.0, &(k * 2).to_string(), &street);
                }
            }
            x += 22.0;
        }
    }
    for (col, x) in xs.iter().enumerate() {
        let street = b.name(8 + col).to_string();
        let mut k = 0;
        let mut y = y0 + 12.0;
        while y + 9.0 < y1 {
            if ys.iter().all(|c| (y + 4.5 - c).abs() > 24.0) {
                k += 1;
                if x - 22.0 > x0 {
                    b.house(x - 22.0, y, &(k * 2 - 1).to_string(), &street);
                }
                if x + 10.0 + 12.0 < x1 {
                    b.house(x + 10.0, y, &(k * 2).to_string(), &street);
                }
            }
            y += 22.0;
        }
    }

    // one named asphalt footway in the first full block with three houses whose address is the footway itself: the engine shows such a path (dashed)
    if let (Some(&xa), Some(&ya)) = (xs.first(), ys.first()) {
        if xa + BLOCK < x1 && ya + BLOCK < y1 {
            let (px, street) = (xa + BLOCK / 2.0, "Parkpfad".to_string());
            let (n1, n2) = (b.end_node(), b.end_node());
            b.way(300, json!({"highway": "footway", "surface": "asphalt", "name": "Parkpfad"}), vec![n1, n2], vec![(px, ya + 28.0), (px, ya + BLOCK - 28.0)]);
            for (n, dy) in [34.0, 46.0, 58.0].into_iter().enumerate() {
                b.house(px + 8.0, ya + dy, &format!("{}a", n + 1), &street);
            }
        }
    }
    json!({"version": 0.6, "elements": b.elements})
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_pack::normalize;

    const BOX: [f64; 4] = [51.2, 13.0, 51.2025, 13.004];

    #[test]
    fn the_answer_is_a_clean_neighbourhood() {
        let (raw, stats) = normalize(&overpass(BOX, "g1")).expect("an element list");
        assert!(stats.dropped.is_empty(), "{:?}", stats.dropped);
        assert!(stats.ways >= 5 && stats.buildings > 40, "{stats:?}");
        assert_eq!(raw.ways.len(), stats.ways);
        assert!(raw.ways.iter().all(|w| w.nodes.is_some()), "every road has its node ids, so the engine can join them");
    }

    #[test]
    fn the_same_box_gives_the_same_answer_and_the_salt_changes_the_ids() {
        assert_eq!(overpass(BOX, "g1"), overpass(BOX, "g1"));
        assert_ne!(overpass(BOX, "g1"), overpass(BOX, "g2"));
    }

    #[test]
    fn a_footway_with_houses_is_in_the_first_full_block() {
        let text = overpass(BOX, "g1").to_string();
        assert_eq!(text.matches("\"footway\"").count(), 1);
        assert!(text.contains("\"1a\""));
    }
}
