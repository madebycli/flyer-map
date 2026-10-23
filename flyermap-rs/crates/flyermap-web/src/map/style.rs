//! Our layers on top of the basemap (port of `installLayers` in `src/v5/map/fieldMap.ts`), as MapLibre JSON. A status colour is what was set
//! through feature-state since the tiles were cut, else what the engine cut into the tile (`st`), else open. New in this app: paths (footways,
//! tracks the engine keeps for houses) are drawn dashed and thinner, streets solid.
use crate::{platform::Theme, ui::status::color};
use flyermap_core::Status;
use serde_json::{json, Value};

pub const TILES: &str = "v5-tiles";
pub const AREAS: &str = "v5-areas";
pub const CONTEXT: &str = "v5-context";
/// The device's position (one point) and the Gebiet being drawn.
pub const ME: &str = "v5-me";
pub const DRAW: &str = "v5-draw";
/// Streets are drawn (and cut into the tiles) from this zoom on; below it the dots show the progress (`SEGMENTS_FROM` of the engine).
pub const SEGMENTS_FROM: f64 = 14.0;
/// The layers a tap, a stroke or a brush can hit.
pub const HOUSES_FILL: &str = "v5-houses-fill";
pub const HOUSES_DOTS: &str = "v5-houses-dots";
pub const STREETS: &str = "v5-segments-line";
pub const PATHS: &str = "v5-paths-line";
/// Layers whose filter follows "Nur Straßen mit Häusern".
pub const SEGMENT_LAYERS: [&str; 4] = ["v5-segments-casing", "v5-segments-preview", STREETS, PATHS];

fn baked() -> Value {
    json!(["match", ["to-string", ["get", "st"]], "c", "completed", "l", "later", "n", "not-deliverable", "open"])
}
fn now() -> Value {
    json!(["coalesce", ["feature-state", "status"], baked()])
}
fn by_status(open: Value, done: Value) -> Value {
    json!(["match", now(), "open", open, done])
}
fn status_color(theme: Theme) -> Value {
    let c = |s| color(theme, s);
    json!(["match", now(), "completed", c(Status::Completed), "later", c(Status::Later), "not-deliverable", c(Status::NotDeliverable), c(Status::Open)])
}
fn flag(name: &str) -> Value {
    json!(["boolean", ["feature-state", name], false])
}

/// The filter of a segment layer: streets or paths, and with "Nur Straßen mit Häusern" only pieces with houses (`h`).
pub fn segment_filter(layer: &str, houses_only: bool) -> Value {
    let kind = match layer {
        PATHS => json!(["==", ["get", "p"], "1"]),
        "v5-segments-preview" => json!(["has", "key"]),
        _ => json!(["!=", ["get", "p"], "1"]),
    };
    if houses_only {
        json!(["all", kind, ["==", ["get", "h"], "1"]])
    } else {
        kind
    }
}

pub fn blank_style(theme: Theme) -> String {
    let bg = if theme == Theme::Dark { "#0e1513" } else { "#eef1ef" };
    json!({"version": 8, "sources": {}, "layers": [{"id": "bg", "type": "background", "paint": {"background-color": bg}}]}).to_string()
}

pub fn sources(tile_url: &str) -> Vec<(&'static str, Value)> {
    let empty = json!({"type": "geojson", "data": {"type": "FeatureCollection", "features": []}});
    vec![
        (
            TILES,
            json!({"type": "vector", "tiles": [tile_url], "minzoom": 11, "maxzoom": 17, "promoteId": {"segments": "key", "houses": "key", "centers": "key"}}),
        ),
        (AREAS, empty.clone()),
        (CONTEXT, empty.clone()),
        (ME, empty.clone()),
        (DRAW, empty),
    ]
}

/// The drawing of a Gebiet and the device's position, on top of everything (see `areas::draw` for the properties of the features).
fn overlay_layers(dark: bool) -> Vec<Value> {
    let ink = if dark { "#8fb8ff" } else { "#2a62c9" };
    let bad = if dark { "#f2b8b5" } else { "#ba1a1a" };
    let ring = if dark { "#0e1513" } else { "#ffffff" };
    let colour = json!(["case", ["==", ["get", "bad"], 1], bad, ink]);
    vec![
        json!({"id": "v5-draw-fill", "type": "fill", "source": DRAW, "filter": ["==", ["geometry-type"], "Polygon"],
            "paint": {"fill-color": colour.clone(), "fill-opacity": 0.2}}),
        json!({"id": "v5-draw-line", "type": "line", "source": DRAW, "filter": ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
            "layout": {"line-join": "round", "line-cap": "round"}, "paint": {"line-color": colour.clone(), "line-width": 3.5, "line-dasharray": [2, 1.4]}}),
        json!({"id": "v5-draw-points", "type": "circle", "source": DRAW, "filter": ["==", ["geometry-type"], "Point"],
            "paint": {"circle-color": colour, "circle-radius": ["case", ["==", ["get", "kind"], "snap"], 10, 5.5], "circle-stroke-width": 2.5, "circle-stroke-color": ring,
                "circle-opacity": ["case", ["==", ["get", "kind"], "snap"], 0.55, 1]}}),
        json!({"id": "v5-me-halo", "type": "circle", "source": ME, "paint": {"circle-color": "#3b82f6", "circle-opacity": 0.22, "circle-radius": 20}}),
        json!({"id": "v5-me-dot", "type": "circle", "source": ME, "paint": {"circle-color": "#3b82f6", "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff"}}),
    ]
}

fn tiles(id: &str, source_layer: &str, kind: &str) -> Value {
    json!({"id": id, "type": kind, "source": TILES, "source-layer": source_layer})
}

fn with(mut base: Value, extra: Value) -> Value {
    if let (Some(b), Value::Object(e)) = (base.as_object_mut(), extra) {
        b.extend(e);
    }
    base
}

pub fn layers(theme: Theme, houses_only: bool) -> Vec<Value> {
    let dark = theme == Theme::Dark;
    let (open_line, done_line) = (0.5, 0.92);
    let grey = if dark { "#9aa5a0" } else { "#5d6762" };
    let casing = if dark { "rgba(7,11,10,0.92)" } else { "rgba(255,255,255,0.92)" };
    let outline = if dark { "rgba(7,11,10,0.55)" } else { "rgba(32,33,36,0.45)" };
    let preview = if dark { "#8fb8ff" } else { "#2a62c9" };
    let selected_outline = if dark { "#ffffff" } else { "#202124" };
    let round = json!({"line-cap": "round", "line-join": "round"});
    let street_width = json!(["interpolate", ["exponential", 1.5], ["zoom"], 10, 0.4, 13, 0.9, 16, 3.6, 20, 11]);
    let path_width = json!(["interpolate", ["exponential", 1.5], ["zoom"], 14, 1.2, 16, 2.4, 20, 7]);
    let line_opacity = json!(["interpolate", ["linear"], ["zoom"], 11, by_status(json!(0.3), json!(0.55)), 14, by_status(json!(open_line), json!(done_line))]);
    let filter = |id: &str| segment_filter(id, houses_only);
    let mut all = vec![
        json!({"id": "v5-context-line", "type": "line", "source": CONTEXT, "layout": {"line-join": "round"},
            "paint": {"line-color": grey, "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [1.6, 2.4]}}),
        json!({"id": "v5-areas-fill", "type": "fill", "source": AREAS,
            "paint": {"fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.12, 0.04]}}),
        json!({"id": "v5-areas-line", "type": "line", "source": AREAS, "layout": {"line-join": "round"},
            "paint": {"line-color": ["get", "color"], "line-opacity": 0.8, "line-width": ["case", ["==", ["get", "active"], 1], 2.6, 1.6], "line-dasharray": [2.4, 1.8]}}),
        with(
            tiles(HOUSES_DOTS, "centers", "circle"),
            json!({"minzoom": 11.5, "maxzoom": 15.2, "paint": {"circle-color": status_color(theme),
            "circle-opacity": by_status(json!(0.6), json!(0.9)), "circle-stroke-width": 0, "circle-radius": ["interpolate", ["linear"], ["zoom"], 11.5, 0.7, 14, 1.6, 15.2, 3.2]}}),
        ),
        with(
            tiles(HOUSES_FILL, "houses", "fill"),
            json!({"minzoom": 15.2, "paint": {"fill-color": status_color(theme),
            "fill-opacity": ["case", flag("selected"), 1, by_status(json!(0.5), json!(0.85))]}}),
        ),
        with(
            tiles("v5-houses-outline", "houses", "line"),
            json!({"minzoom": 16.5, "layout": round, "paint": {
            "line-color": ["case", flag("selected"), selected_outline, outline], "line-width": ["case", flag("selected"), 2.5, 0.5]}}),
        ),
        with(
            tiles("v5-segments-casing", "segments", "line"),
            json!({"minzoom": 13.5, "filter": filter("v5-segments-casing"), "layout": round,
            "paint": {"line-color": casing, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 13.5, 1.6, 16, 6.5, 20, 18]}}),
        ),
        with(
            tiles("v5-segments-preview", "segments", "line"),
            json!({"filter": filter("v5-segments-preview"), "layout": round, "paint": {"line-color": preview,
            "line-opacity": ["case", flag("preview"), 0.7, 0], "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 5, 16, 13, 20, 32]}}),
        ),
        with(
            tiles(STREETS, "segments", "line"),
            json!({"minzoom": SEGMENTS_FROM, "filter": filter(STREETS), "layout": round,
            "paint": {"line-color": status_color(theme), "line-opacity": line_opacity.clone(), "line-width": street_width}}),
        ),
        with(
            tiles(PATHS, "segments", "line"),
            json!({"minzoom": SEGMENTS_FROM, "filter": filter(PATHS), "layout": {"line-join": "round"},
            "paint": {"line-color": status_color(theme), "line-opacity": line_opacity, "line-width": path_width, "line-dasharray": [1.4, 1.1]}}),
        ),
        with(
            tiles("v5-houses-preview", "houses", "line"),
            json!({"minzoom": 15.2, "paint": {"line-color": preview, "line-width": 2.5,
            "line-opacity": ["case", flag("preview"), 1, 0]}}),
        ),
    ];
    all.extend(overlay_layers(dark));
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer<'a>(all: &'a [Value], id: &str) -> &'a Value {
        all.iter().find(|l| l["id"] == id).unwrap()
    }

    #[test]
    fn paths_are_dashed_and_streets_solid() {
        let all = layers(Theme::Dark, false);
        assert_eq!(layer(&all, PATHS)["filter"], json!(["==", ["get", "p"], "1"]));
        assert!(layer(&all, PATHS)["paint"]["line-dasharray"].is_array());
        assert_eq!(layer(&all, STREETS)["filter"], json!(["!=", ["get", "p"], "1"]));
        assert!(layer(&all, STREETS)["paint"].get("line-dasharray").is_none());
    }

    #[test]
    fn houses_only_narrows_every_segment_layer() {
        for id in SEGMENT_LAYERS {
            let f = segment_filter(id, true);
            assert_eq!(f[0], "all", "{id}");
            assert_eq!(f[2], json!(["==", ["get", "h"], "1"]));
        }
    }

    #[test]
    fn the_status_colours_are_the_ones_of_the_screens() {
        let text = serde_json::to_string(&layers(Theme::Light, false)).unwrap();
        for s in Status::ALL {
            assert!(text.contains(color(Theme::Light, s)));
        }
        assert!(text.contains(r#"["coalesce",["feature-state","status"]"#), "feature-state wins over the baked status");
        assert!(blank_style(Theme::Dark).contains("#0e1513"));
    }
}
