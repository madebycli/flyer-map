//! What the engine hands to the app about one Gebiet: the coordinate-free street pieces and houses (geometry stays in the engine and
//! leaves as vector tiles). Only the fields the app uses are read; the engine's JSON is the edge (`SlimNetwork` in flyermap-engine).
use serde::Deserialize;

pub type LngLat = [f64; 2];

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    /// The junction-to-junction street piece this chunk belongs to.
    pub group: String,
    pub chunk: u32,
    pub name: Option<String>,
    pub length: f64,
    pub from: String,
    pub to: String,
    pub house_count: u32,
    pub visible: bool,
    pub mid: LngLat,
    pub start: LngLat,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct House {
    pub id: String,
    pub center: LngLat,
    /// The street piece the house is counted on.
    pub parent: Option<String>,
    /// A house on a footway whose address names a street: the street piece it belongs to.
    pub street_parent: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Network {
    pub segments: Vec<Segment>,
    pub houses: Vec<House>,
}

/// `session_route`: the street pieces between the tapped anchors, or no connection.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum Route {
    #[serde(rename_all = "camelCase")]
    Selected {
        segment_ids: Vec<String>,
        length: f64,
        ambiguous: bool,
    },
    Disconnected,
}

/// `session_lasso`: what lies inside the drawn outline.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Lassoed {
    pub houses: Vec<String>,
    pub segments: Vec<String>,
}

/// `session_search`: one street or address.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Found {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engine_json_is_read() {
        let n: Network = serde_json::from_str(
            r#"{"segments":[{"id":"1#0","group":"1","chunk":0,"chunks":1,"wayId":1,"name":"A","ref":null,"highway":"residential","cls":"street","length":12.5,
            "from":"n1","to":"n2","houseCount":2,"visible":true,"mid":[13.0,51.0],"start":[13.0,51.0]}],
            "houses":[{"id":"b5","osmId":5,"source":"building","number":"1","street":"A","center":[13.0,51.0],"parent":"1#0","measure":null,"streetParent":null,"evidence":"address"}],
            "diagnostics":{}}"#,
        )
        .unwrap();
        assert_eq!((n.segments[0].house_count, n.houses[0].parent.as_deref()), (2, Some("1#0")));
        let r: Route = serde_json::from_str(r#"{"state":"selected","segmentIds":["a","b"],"length":40.0,"ambiguous":false}"#).unwrap();
        assert_eq!(r, Route::Selected { segment_ids: vec!["a".into(), "b".into()], length: 40.0, ambiguous: false });
        assert_eq!(serde_json::from_str::<Route>(r#"{"state":"disconnected"}"#).unwrap(), Route::Disconnected);
    }
}
