use serde::{Deserialize, Serialize};

/// A GeoJSON polygon: the outline of a Gebiet (`coordinates[0]` is the outer ring, `[longitude, latitude]` pairs).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename = "Polygon")]
pub struct Polygon {
    pub coordinates: Vec<Vec<[f64; 2]>>,
}

impl Polygon {
    pub fn outer(&self) -> &[[f64; 2]] {
        self.coordinates.first().map_or(&[], Vec::as_slice)
    }
}
