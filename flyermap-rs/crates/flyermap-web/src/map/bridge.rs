//! The MapLibre bridge as typed functions (`assets/js/map-bridge.js`; MapLibre GL JS itself is used as it is). Layers, sources and expressions
//! cross as JSON text, numbers as numbers; nothing else of MapLibre's API is visible above this file.
use js_sys::{Float64Array, Function};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/assets/js/map-bridge.js")]
extern "C" {
    pub type MlMap;

    /// Load MapLibre (once); answers its version.
    #[wasm_bindgen(catch)]
    pub async fn load() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    pub fn create(container: &web_sys::HtmlElement, style: &str, lng: f64, lat: f64, zoom: f64, pixel_ratio: f64) -> Result<MlMap, JsValue>;
    pub fn on(map: &MlMap, name: &str, callback: &Function);
    #[wasm_bindgen(js_name = setStyle)]
    pub fn set_style(map: &MlMap, style: &str);
    #[wasm_bindgen(js_name = isStyleLoaded)]
    pub fn is_style_loaded(map: &MlMap) -> bool;
    #[wasm_bindgen(js_name = hasSource)]
    pub fn has_source(map: &MlMap, id: &str) -> bool;
    #[wasm_bindgen(js_name = hasLayer)]
    pub fn has_layer(map: &MlMap, id: &str) -> bool;
    #[wasm_bindgen(js_name = addSource, catch)]
    pub fn add_source(map: &MlMap, id: &str, json: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = addLayer, catch)]
    pub fn add_layer(map: &MlMap, json: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = setFilter)]
    pub fn set_filter(map: &MlMap, id: &str, json: Option<&str>);
    #[wasm_bindgen(js_name = setData)]
    pub fn set_data(map: &MlMap, id: &str, json: &str);
    #[wasm_bindgen(js_name = setTiles)]
    pub fn set_tiles(map: &MlMap, id: &str, url: &str);
    #[wasm_bindgen(js_name = setTileProvider)]
    pub fn set_tile_provider(token: &str, provider: &Function);
    #[wasm_bindgen(js_name = dropTileProvider)]
    pub fn drop_tile_provider(token: &str);
    #[wasm_bindgen(js_name = hideSymbols)]
    pub fn hide_symbols(map: &MlMap, pattern: &str);
    /// Feature-state `name = value` for the keys (joined by `\n`); answers how many keys.
    #[wasm_bindgen(js_name = setState)]
    pub fn set_state(map: &MlMap, source: &str, keys: &str, name: &str, value: &JsValue) -> u32;
    #[wasm_bindgen(js_name = clearStates)]
    pub fn clear_states(map: &MlMap, source: &str);
    /// Rendered features in the box with screen geometry, as JSON (see `hit::Drawn`).
    pub fn query(map: &MlMap, x0: f64, y0: f64, x1: f64, y1: f64, layers: &str) -> String;
    pub fn unproject(map: &MlMap, x: f64, y: f64) -> Float64Array;
    /// `[lng, lat, zoom, bearing, west, south, east, north]`.
    pub fn view(map: &MlMap) -> Float64Array;
    #[wasm_bindgen(js_name = dragPan)]
    pub fn drag_pan(map: &MlMap, on: bool);
    #[wasm_bindgen(js_name = doubleClickZoom)]
    pub fn double_click_zoom(map: &MlMap, on: bool);
    #[wasm_bindgen(js_name = zoomBy)]
    pub fn zoom_by(map: &MlMap, delta: f64);
    #[wasm_bindgen(js_name = resetNorth)]
    pub fn reset_north(map: &MlMap);
    #[wasm_bindgen(js_name = easeTo)]
    pub fn ease_to(map: &MlMap, lng: f64, lat: f64, zoom: f64);
    pub fn reveal(map: &MlMap, lng: f64, lat: f64, zoom: f64);
    #[wasm_bindgen(js_name = fitBounds)]
    pub fn fit_bounds(map: &MlMap, west: f64, south: f64, east: f64, north: f64, padding: f64);
    #[wasm_bindgen(js_name = jumpTo)]
    pub fn jump_to(map: &MlMap, lng: f64, lat: f64, zoom: f64);
    pub fn container(map: &MlMap) -> web_sys::HtmlElement;
    #[wasm_bindgen(js_name = canvasSize)]
    pub fn canvas_size(map: &MlMap) -> Float64Array;
    #[wasm_bindgen(js_name = debugCounts)]
    pub fn debug_counts(map: &MlMap) -> String;
    pub fn remove(map: &MlMap);
}
