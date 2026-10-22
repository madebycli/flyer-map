//! An Overpass answer cleaned up into the raw pack: roads, closed building rings, address nodes. Bad elements are counted, never thrown on,
//! never silently kept; only an answer that is not an element list (or an element JavaScript could not even walk) fails.
use crate::plan::LngLat;
use serde::{Serialize, Serializer};
use serde_json::Value;
use std::collections::HashMap;

/// A number as `JSON.stringify` writes it (whole numbers without `.0`), so both sides compare equal after parsing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct JsNum(pub f64);

impl Serialize for JsNum {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.0.fract() == 0.0 && self.0.abs() < 9_007_199_254_740_992.0 {
            s.serialize_i64(self.0 as i64)
        } else {
            s.serialize_f64(self.0)
        }
    }
}

fn js_points<S: Serializer>(points: &[LngLat], s: S) -> Result<S::Ok, S::Error> {
    s.collect_seq(points.iter().map(|p| [JsNum(p[0]), JsNum(p[1])]))
}
fn js_point<S: Serializer>(p: &LngLat, s: S) -> Result<S::Ok, S::Error> {
    [JsNum(p[0]), JsNum(p[1])].serialize(s)
}
fn js_tags<S: Serializer>(tags: &[(String, String)], s: S) -> Result<S::Ok, S::Error> {
    s.collect_map(tags.iter().map(|(k, v)| (k, v)))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Way {
    pub id: JsNum,
    #[serde(serialize_with = "js_tags")]
    pub tags: Vec<(String, String)>,
    #[serde(serialize_with = "js_points")]
    pub coords: Vec<LngLat>,
    /// The node ids as Overpass sent them, when there is one per point.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Building {
    pub id: JsNum,
    #[serde(serialize_with = "js_tags")]
    pub tags: Vec<(String, String)>,
    #[serde(serialize_with = "js_points")]
    pub ring: Vec<LngLat>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Address {
    pub id: JsNum,
    #[serde(serialize_with = "js_tags")]
    pub tags: Vec<(String, String)>,
    #[serde(serialize_with = "js_point")]
    pub point: LngLat,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct RawOsm {
    pub ways: Vec<Way>,
    pub buildings: Vec<Building>,
    pub addresses: Vec<Address>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PackStats {
    pub elements: usize,
    pub ways: usize,
    pub buildings: usize,
    pub addresses: usize,
    #[serde(serialize_with = "js_dropped")]
    pub dropped: Vec<(&'static str, usize)>,
}

fn js_dropped<S: Serializer>(dropped: &[(&'static str, usize)], s: S) -> Result<S::Ok, S::Error> {
    s.collect_map(dropped.iter().map(|(k, v)| (k, v)))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NormalizeError {
    /// No `elements` list.
    NotElements,
    /// An element whose geometry is not a list (the TypeScript side throws there).
    BadGeometry,
}

/// JavaScript's `Number(value)`; `None` for a missing value (`undefined` → NaN).
fn number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => number_text(s),
        Some(Value::Array(items)) => match items.as_slice() {
            [] => 0.0,
            [Value::Number(n)] => n.as_f64().unwrap_or(f64::NAN),
            [Value::String(s)] => number_text(s),
            [Value::Null] => 0.0,
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

fn number_text(text: &str) -> f64 {
    let t = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if t.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).map_or(f64::NAN, |v| v as f64);
        }
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'-' => (-1.0, &t[1..]),
        b'+' => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if body.is_empty() || !body.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-')) {
        return f64::NAN;
    }
    body.parse::<f64>().map_or(f64::NAN, |v| sign * v)
}

fn valid(p: LngLat) -> bool {
    p[0].is_finite() && p[1].is_finite() && p[0].abs() <= 180.0 && p[1].abs() <= 85.0
}

/// `Object.entries(raw ?? {})`, keeping the string values (at most 200 UTF-16 units).
fn tags_of(raw: Option<&Value>) -> Vec<(String, String)> {
    let cut = |v: &str| {
        let mut units = 0;
        v.chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= 200
            })
            .collect::<String>()
    };
    match raw {
        Some(Value::Object(map)) => map.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), cut(v)))).collect(),
        Some(Value::Array(items)) => items.iter().enumerate().filter_map(|(i, v)| v.as_str().map(|v| (i.to_string(), cut(v)))).collect(),
        Some(Value::String(s)) => s.chars().enumerate().map(|(i, c)| (i.to_string(), c.to_string())).collect(),
        _ => Vec::new(),
    }
}

fn tag<'a>(tags: &'a [(String, String)], key: &str) -> Option<&'a str> {
    tags.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).filter(|v| !v.is_empty())
}

/// Insertion-ordered map by OSM id: a later element with the same id replaces the value and keeps the place (like a JavaScript `Map`).
struct ById<T> {
    items: Vec<T>,
    index: HashMap<u64, usize>,
}

impl<T> ById<T> {
    fn new() -> Self {
        ById { items: Vec::new(), index: HashMap::new() }
    }
    fn set(&mut self, id: f64, item: T) {
        let key = if id == 0.0 { 0 } else { id.to_bits() };
        match self.index.get(&key) {
            Some(&i) => self.items[i] = item,
            None => {
                self.index.insert(key, self.items.len());
                self.items.push(item);
            }
        }
    }
}

fn point_of(g: &Value) -> LngLat {
    match g {
        Value::Object(o) => [number(o.get("lon")), number(o.get("lat"))],
        _ => [f64::NAN, f64::NAN],
    }
}

pub fn normalize(response: &Value) -> Result<(RawOsm, PackStats), NormalizeError> {
    let Some(elements) = response.get("elements").and_then(Value::as_array).filter(|_| response.is_object()) else { return Err(NormalizeError::NotElements) };
    let mut stats = PackStats { elements: elements.len(), ..PackStats::default() };
    let mut drop = |reason: &'static str| match stats.dropped.iter_mut().find(|(r, _)| *r == reason) {
        Some(entry) => entry.1 += 1,
        None => stats.dropped.push((reason, 1)),
    };
    let (mut ways, mut buildings, mut addresses) = (ById::new(), ById::new(), ById::new());
    for element in elements {
        let Some(id) = element.as_object().and_then(|o| o.get("id")).and_then(Value::as_f64) else {
            drop("no_id");
            continue;
        };
        let tags = tags_of(element.get("tags"));
        match element.get("type").and_then(Value::as_str) {
            Some("node") => {
                if tag(&tags, "addr:housenumber").is_none() {
                    continue;
                }
                let point = [number(element.get("lon")), number(element.get("lat"))];
                if !valid(point) {
                    drop("node_bad_coordinate");
                    continue;
                }
                addresses.set(id, Address { id: JsNum(id), tags, point });
            }
            Some("way") => {
                let coords: Vec<LngLat> = match element.get("geometry") {
                    None | Some(Value::Null) => Vec::new(),
                    Some(Value::Array(points)) => points.iter().map(point_of).collect(),
                    Some(_) => return Err(NormalizeError::BadGeometry),
                };
                if coords.len() < 2 || !coords.iter().all(|p| valid(*p)) {
                    drop("way_bad_geometry");
                    continue;
                }
                if tag(&tags, "highway").is_some() {
                    let nodes = match element.get("nodes") {
                        Some(n @ Value::Array(items)) if items.len() == coords.len() => Some(n.clone()),
                        Some(n @ Value::String(s)) if s.encode_utf16().count() == coords.len() => Some(n.clone()),
                        _ => None,
                    };
                    ways.set(id, Way { id: JsNum(id), tags, coords, nodes });
                } else if tag(&tags, "building").is_some() {
                    let (first, last) = (coords[0], coords[coords.len() - 1]);
                    if coords.len() < 4 || first[0] != last[0] || first[1] != last[1] {
                        drop("building_ring_open");
                        continue;
                    }
                    buildings.set(id, Building { id: JsNum(id), tags, ring: coords });
                }
            }
            _ => {}
        }
    }
    stats.ways = ways.items.len();
    stats.buildings = buildings.items.len();
    stats.addresses = addresses.items.len();
    Ok((RawOsm { ways: ways.items, buildings: buildings.items, addresses: addresses.items }, stats))
}
