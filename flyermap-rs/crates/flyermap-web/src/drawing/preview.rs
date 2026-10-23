//! The drawing as the map shows it (the `v5-draw` source): a dashed line through the points, a point at every corner, a faint ring where a point lies on a
//! border, and the finished outline filled. Everything turns red while the drawing does not work. Pure: GeoJSON text out.
use super::{
    state::Draw,
    verdict::{Ready, Verdict},
};
use serde_json::{json, Value};

pub fn geojson(draw: &Draw, verdict: &Verdict) -> String {
    let bad = i32::from(matches!(verdict, Verdict::Bad(_)));
    let mut features: Vec<Value> = Vec::new();
    if let Verdict::Ready(Ready { ring, .. }) = verdict {
        features.push(json!({"type": "Feature", "properties": {"bad": 0}, "geometry": {"type": "Polygon", "coordinates": [ring]}}));
    }
    let line = draw.positions();
    if line.len() >= 2 {
        features.push(json!({"type": "Feature", "properties": {"bad": bad}, "geometry": {"type": "LineString", "coordinates": line}}));
    }
    for p in &draw.points {
        if p.border.is_some() {
            features.push(json!({"type": "Feature", "properties": {"kind": "snap", "bad": bad}, "geometry": {"type": "Point", "coordinates": p.at}}));
        }
        features.push(json!({"type": "Feature", "properties": {"kind": "vertex", "bad": bad}, "geometry": {"type": "Point", "coordinates": p.at}}));
    }
    json!({"type": "FeatureCollection", "features": features}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawing::state::{Kind, Point};

    fn parsed(text: &str) -> Vec<Value> {
        serde_json::from_str::<Value>(text).unwrap()["features"].as_array().unwrap().clone()
    }

    fn kinds(features: &[Value]) -> Vec<String> {
        features.iter().map(|f| f["geometry"]["type"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn nothing_drawn_is_an_empty_collection() {
        assert!(parsed(&geojson(&Draw::default(), &Verdict::Next(String::new()))).is_empty());
    }

    #[test]
    fn a_drawing_shows_its_line_and_a_point_per_corner() {
        let mut d = Draw::new(Kind::Free, None);
        d.points = vec![Point { at: [13.0, 51.0], border: None }, Point { at: [13.1, 51.0], border: None }, Point { at: [13.1, 51.1], border: None }];
        let f = parsed(&geojson(&d, &Verdict::Next(String::new())));
        assert_eq!(kinds(&f), ["LineString", "Point", "Point", "Point"]);
        assert!(f.iter().all(|x| x["properties"]["bad"] == 0));
    }

    #[test]
    fn a_ready_drawing_is_filled_and_a_bad_one_is_red() {
        let mut d = Draw::new(Kind::Free, None);
        d.points = vec![Point { at: [13.0, 51.0], border: None }, Point { at: [13.1, 51.0], border: None }];
        let ready = Verdict::Ready(Ready {
            kind: Kind::Free,
            ring: vec![[13.0, 51.0], [13.1, 51.0], [13.1, 51.1], [13.0, 51.0]],
            creates: true,
            changed: Vec::new(),
            size: String::new(),
        });
        assert_eq!(kinds(&parsed(&geojson(&d, &ready)))[0], "Polygon");
        let bad = parsed(&geojson(&d, &Verdict::Bad("x".into())));
        assert!(bad.iter().all(|x| x["properties"]["bad"] == 1));
    }

    #[test]
    fn a_point_on_a_border_gets_a_ring_around_it() {
        let mut d = Draw::new(Kind::Connect, None);
        d.points = vec![Point { at: [13.0, 51.0], border: Some(flyermap_area::BorderPoint { area: 0, edge: 0, t: 0.5 }) }];
        let f = parsed(&geojson(&d, &Verdict::Next(String::new())));
        assert_eq!(f.iter().filter(|x| x["properties"]["kind"] == "snap").count(), 1);
    }
}
