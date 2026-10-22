//! A synthetic city as an Overpass answer, and edits to it. Port of `syntheticCity` (`src/v5/engine/synthetic.ts`): a street grid with shared
//! node ids at the crossings, rows of houses along every block side, a side street, a forest track, a sidewalk, a driveway, a house-less
//! cut-through path and a back-lot service road. `city(80)` has about 51 000 houses. Nothing here is a real place: the origin lies in the
//! open sea and the names are made up.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const M_LAT: f64 = 110_574.0;
const BLOCK: f64 = 100.0;
pub const ORIGIN: [f64; 2] = [-30.0, 45.0];

pub struct Rng(pub u64);
impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Metres east and north of an origin, as longitude and latitude.
#[derive(Clone, Copy)]
pub struct Frame(pub [f64; 2]);
impl Frame {
    pub fn m_lng(&self) -> f64 {
        111_320.0 * (self.0[1] * std::f64::consts::PI / 180.0).cos()
    }
    pub fn pt(&self, x: f64, y: f64) -> [f64; 2] {
        [self.0[0] + x / self.m_lng(), self.0[1] + y / M_LAT]
    }
}

fn geometry(points: &[[f64; 2]]) -> Value {
    Value::Array(points.iter().map(|p| json!({ "lat": p[1], "lon": p[0] })).collect())
}

pub struct City {
    /// What Overpass would answer (`{"elements": [...]}`).
    pub answer: Value,
    /// The outline of the Gebiet: the whole grid with a margin (south-west, south-east, north-east, north-west, closed).
    pub ring: Vec<[f64; 2]>,
    pub houses: usize,
}

fn way(id: u64, tags: Value, points: &[[f64; 2]], nodes: &[u64]) -> Value {
    json!({ "type": "way", "id": id, "nodes": nodes, "tags": tags, "geometry": geometry(points) })
}

fn house(f: Frame, id: u64, x: f64, y: f64, number: &str, street: &str) -> Value {
    let ring = [f.pt(x, y), f.pt(x + 12.0, y), f.pt(x + 12.0, y + 10.0), f.pt(x, y + 10.0), f.pt(x, y)];
    way(id, json!({ "building": "house", "addr:housenumber": number, "addr:street": street }), &ring, &[])
}

/// A city of `blocks` x `blocks` blocks (8 houses per block) at the default origin.
pub fn city(blocks: usize) -> City {
    city_at(blocks, Frame(ORIGIN))
}

/// The same city with its south-west corner at the frame's origin.
pub fn city_at(blocks: usize, f: Frame) -> City {
    let node_id = |i: usize, j: usize| 1_000_000 + (i * 10_000 + j) as u64;
    let mut elements: Vec<Value> = Vec::new();
    let mut next_node = 90_000_000u64;
    let mut take = |n: usize| {
        let from = next_node;
        next_node += n as u64;
        (from..from + n as u64).collect::<Vec<u64>>()
    };
    for j in 0..=blocks {
        let points: Vec<_> = (0..=blocks).map(|i| f.pt(i as f64 * BLOCK, j as f64 * BLOCK)).collect();
        let nodes: Vec<_> = (0..=blocks).map(|i| node_id(i, j)).collect();
        elements.push(way(1000 + j as u64, json!({ "highway": "residential", "name": format!("Querstraße {}", j + 1) }), &points, &nodes));
    }
    for i in 0..=blocks {
        let points: Vec<_> = (0..=blocks).map(|j| f.pt(i as f64 * BLOCK, j as f64 * BLOCK)).collect();
        let nodes: Vec<_> = (0..=blocks).map(|j| node_id(i, j)).collect();
        elements.push(way(2000 + i as u64, json!({ "highway": "residential", "name": format!("Längsweg {}", i + 1) }), &points, &nodes));
    }
    let (mut building, mut houses) = (5_000_000u64, 0usize);
    let per = (((BLOCK - 20.0) / 20.0) as usize).max(1);
    for i in 0..blocks {
        for j in 0..blocks {
            for k in 0..per {
                let x = i as f64 * BLOCK + 10.0 + k as f64 * 20.0;
                let number = |n: usize| (n + i * 2 * per).to_string();
                elements.push(house(f, building, x, j as f64 * BLOCK + 8.0, &number(k * 2 + 1), &format!("Querstraße {}", j + 1)));
                elements.push(house(f, building + 1, x, (j + 1) as f64 * BLOCK - 18.0, &number(k * 2 + 2), &format!("Querstraße {}", j + 2)));
                building += 2;
                houses += 2;
            }
        }
    }
    // The tricky extras, beside and behind the grid.
    let nodes = take(2);
    elements.push(way(3000, json!({ "highway": "residential", "name": "Stichstraße" }), &[f.pt(BLOCK * 1.5, 0.0), f.pt(BLOCK * 1.5, -60.0)], &nodes));
    for k in 0..3 {
        elements.push(house(f, building, BLOCK * 1.5 + 8.0, -50.0 + k as f64 * 15.0, &(k + 1).to_string(), "Stichstraße"));
        (building, houses) = (building + 1, houses + 1);
    }
    let extras = [
        (3001, json!({ "highway": "track", "name": "Waldweg" }), vec![f.pt(-80.0, -40.0), f.pt(-10.0, 30.0), f.pt(60.0, -20.0)]),
        (3002, json!({ "highway": "footway", "footway": "sidewalk" }), vec![f.pt(5.0, 4.0), f.pt(BLOCK - 5.0, 4.0)]),
        (3003, json!({ "highway": "service", "service": "driveway" }), vec![f.pt(30.0, 0.0), f.pt(30.0, 6.0)]),
        (3004, json!({ "highway": "footway", "surface": "asphalt" }), vec![f.pt(50.0, BLOCK + 30.0), f.pt(50.0, BLOCK + 70.0)]),
        (3005, json!({ "highway": "service" }), vec![f.pt(0.0, -200.0), f.pt(60.0, -200.0)]),
    ];
    for (id, tags, points) in extras {
        let nodes = take(points.len());
        elements.push(way(id, tags, &points, &nodes));
    }
    for k in 0..3 {
        elements.push(house(f, building, 8.0 + k as f64 * 18.0, -194.0, &format!("H{}", k + 1), "Hinterhof"));
        (building, houses) = (building + 1, houses + 1);
    }
    let end = blocks as f64 * BLOCK;
    let ring = vec![f.pt(-300.0, -300.0), f.pt(end + 300.0, -300.0), f.pt(end + 300.0, end + 300.0), f.pt(-300.0, end + 300.0), f.pt(-300.0, -300.0)];
    City { answer: json!({ "elements": elements }), ring, houses }
}

/// What a round of edits did, for the numbers next to a measurement.
#[derive(Debug, Default)]
pub struct Edits {
    pub renumbered: usize,
    pub removed: usize,
    pub added: usize,
    pub renamed_streets: usize,
}

fn is_building(e: &Value) -> bool {
    e["type"] == "way" && e["tags"].get("building").is_some()
}

/// The answer after OSM edits to about `per_mille` of 1000 buildings (a third renumbered, a third removed, a third with a new neighbour
/// right after them, where the quad-tile order of Overpass would put it) and `streets` named ways renamed. Works for a city at any origin.
pub fn edit(answer: &Value, per_mille: usize, streets: usize, seed: u64) -> (Value, Edits) {
    let mut rng = Rng::new(seed);
    let elements = answer["elements"].as_array().cloned().unwrap_or_default();
    let mut buildings: Vec<usize> = (0..elements.len()).filter(|&i| is_building(&elements[i])).collect();
    let want = buildings.len() * per_mille / 1000;
    for k in 0..want.min(buildings.len()) {
        let pick = k + rng.below(buildings.len() - k);
        buildings.swap(k, pick);
    }
    let plan: HashMap<usize, usize> = buildings.iter().take(want).enumerate().map(|(k, &at)| (at, k % 3)).collect();
    let mut ways: Vec<usize> =
        (0..elements.len()).filter(|&i| elements[i]["tags"].get("highway").is_some() && elements[i]["tags"].get("name").is_some()).collect();
    let mut renamed = HashSet::new();
    for _ in 0..streets.min(ways.len()) {
        renamed.insert(ways.swap_remove(rng.below(ways.len())));
    }
    let (mut edits, mut out, mut fresh) = (Edits::default(), Vec::with_capacity(elements.len() + want), 50_000_000u64);
    for (at, mut e) in elements.into_iter().enumerate() {
        if renamed.contains(&at) {
            e["tags"]["name"] = json!(format!("{} neu", e["tags"]["name"].as_str().unwrap_or("")));
            edits.renamed_streets += 1;
        }
        match plan.get(&at) {
            Some(0) => {
                e["tags"]["addr:housenumber"] = json!(format!("{}a", e["tags"]["addr:housenumber"].as_str().unwrap_or("1")));
                edits.renumbered += 1;
                out.push(e);
            }
            Some(1) => edits.removed += 1,
            Some(_) => {
                let mut neighbour = e.clone();
                fresh += 1;
                neighbour["id"] = json!(fresh);
                neighbour["tags"]["addr:housenumber"] = json!(format!("{}n", fresh % 1000));
                let lat = neighbour["geometry"][0]["lat"].as_f64().unwrap_or(0.0);
                let shift = 14.0 / Frame([0.0, lat]).m_lng();
                if let Some(points) = neighbour["geometry"].as_array_mut() {
                    points.iter_mut().for_each(|p| p["lon"] = json!(p["lon"].as_f64().unwrap_or(0.0) + shift));
                }
                edits.added += 1;
                out.push(e);
                out.push(neighbour);
            }
            None => out.push(e),
        }
    }
    (json!({ "elements": out }), edits)
}
