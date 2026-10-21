use serde::{ser::SerializeSeq, Deserialize, Serialize, Serializer};

/// A GeoJSON polygon: the outline of a Gebiet (`coordinates[0]` is the outer ring, `[longitude, latitude]` pairs).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename = "Polygon")]
pub struct Polygon {
    #[serde(serialize_with = "js_rings")]
    pub coordinates: Vec<Vec<[f64; 2]>>,
}

impl Polygon {
    pub fn outer(&self) -> &[[f64; 2]] {
        self.coordinates.first().map_or(&[], Vec::as_slice)
    }
}

/// A number as JavaScript's `JSON.stringify` writes it: whole numbers without `.0`, so both Workers send the same bytes.
struct JsNumber(f64);

impl Serialize for JsNumber {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let v = self.0;
        if v.fract() == 0.0 && v.abs() < 9_007_199_254_740_992.0 {
            s.serialize_i64(v as i64)
        } else {
            s.serialize_f64(v)
        }
    }
}

fn js_rings<S: Serializer>(rings: &[Vec<[f64; 2]>], s: S) -> Result<S::Ok, S::Error> {
    let mut outer = s.serialize_seq(Some(rings.len()))?;
    for ring in rings {
        let points: Vec<[JsNumber; 2]> = ring
            .iter()
            .map(|p| [JsNumber(p[0]), JsNumber(p[1])])
            .collect();
        outer.serialize_element(&points)?;
    }
    outer.end()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_numbers_are_written_like_javascript() {
        let p = Polygon {
            coordinates: vec![vec![[13.0, 51.0], [13.01, 51.5]]],
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"type":"Polygon","coordinates":[[[13,51],[13.01,51.5]]]}"#
        );
    }
}
