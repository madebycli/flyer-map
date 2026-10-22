//! The Gebiete as the map's GeoJSON: the outlines with their colour (and which ones the person works in), and the outlines of the others.
use crate::model::{Gebiet, LngLat};
use serde_json::{json, Value};

fn collection(features: Vec<Value>) -> String {
    json!({"type": "FeatureCollection", "features": features}).to_string()
}

/// `active`: does the person work in this Gebiet (it is drawn a little stronger).
pub fn areas(gebiete: &[Gebiet], active: &dyn Fn(&Gebiet) -> bool) -> String {
    collection(
        gebiete
            .iter()
            .map(|g| {
                json!({"type": "Feature", "properties": {"id": g.id, "name": g.name, "color": g.color, "active": i32::from(active(g))},
                    "geometry": {"type": "Polygon", "coordinates": [g.ring]}})
            })
            .collect(),
    )
}

pub fn context(rings: &[Vec<LngLat>]) -> String {
    collection(rings.iter().map(|r| json!({"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": r}})).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    #[test]
    fn every_gebiet_is_a_closed_polygon_with_its_colour() {
        let w = world(Persona::Member);
        let v: Value = serde_json::from_str(&areas(&w.gebiete, &|g| g.writable)).unwrap();
        let f = v["features"].as_array().unwrap();
        assert_eq!(f.len(), 4);
        assert_eq!(f[0]["properties"]["color"], "#4f8fdc");
        assert_eq!((f[0]["properties"]["active"].as_i64(), f[1]["properties"]["active"].as_i64()), (Some(1), Some(0)), "only the own Gruppe is active");
        let ring = f[0]["geometry"]["coordinates"][0].as_array().unwrap();
        assert_eq!(ring.first(), ring.last());
    }

    #[test]
    fn the_outlines_of_others_are_plain_lines() {
        let v: Value = serde_json::from_str(&context(&[vec![[13.0, 51.0], [13.1, 51.0], [13.0, 51.0]]])).unwrap();
        assert_eq!(v["features"][0]["geometry"]["type"], "LineString");
        assert_eq!(serde_json::from_str::<Value>(&context(&[])).unwrap()["features"].as_array().map(Vec::len), Some(0));
    }
}
