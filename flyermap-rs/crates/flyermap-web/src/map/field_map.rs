//! The field map: MapLibre with the basemap of the deployment and our layers on top. It owns no data: tiles come from the engine through the
//! tile protocol, statuses are cut into the tiles by the engine and changed ones are painted through feature-state at once. Switching the
//! theme or the basemap swaps the style and installs our layers again on `style.load`.
use super::{bridge, style};
use crate::platform::Theme;
use flyermap_core::{Key, Status};
use serde_json::json;
use std::{
    cell::{Cell, RefCell},
    collections::HashSet,
    rc::Rc,
};
use wasm_bindgen::{closure::Closure, JsCast, JsValue};

/// The deployment's basemap styles; `None` for a theme means the plain background.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Basemap {
    pub dark: Option<String>,
    pub light: Option<String>,
}

pub struct Inner {
    pub map: bridge::MlMap,
    token: String,
    theme: Cell<Theme>,
    basemap: RefCell<Basemap>,
    base_visible: Cell<bool>,
    fallback: Cell<bool>,
    houses_only: Cell<bool>,
    tile_version: Cell<u32>,
    areas: RefCell<String>,
    context: RefCell<String>,
    previewed: RefCell<HashSet<Key>>,
    ready: Cell<bool>,
    waiting: RefCell<Vec<Box<dyn FnOnce()>>>,
    keep: RefCell<Vec<Closure<dyn FnMut()>>>,
}

#[derive(Clone)]
pub struct FieldMap(pub Rc<Inner>);

static TOKENS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

impl FieldMap {
    /// Create the map in `container` (MapLibre must be loaded, see `bridge::load`).
    pub fn create(container: &web_sys::HtmlElement, theme: Theme, center: [f64; 2], zoom: f64) -> Option<FieldMap> {
        let ratio = web_sys::window().map(|w| w.device_pixel_ratio()).unwrap_or(1.0).clamp(1.0, 2.0);
        let map = bridge::create(container, &style::blank_style(theme), center[0], center[1], zoom, ratio).ok()?;
        let token = format!("m{}", TOKENS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1);
        let inner = Rc::new(Inner {
            map,
            token,
            theme: Cell::new(theme),
            basemap: RefCell::default(),
            base_visible: Cell::new(true),
            fallback: Cell::new(false),
            houses_only: Cell::new(false),
            tile_version: Cell::new(0),
            areas: RefCell::new(json!({"type": "FeatureCollection", "features": []}).to_string()),
            context: RefCell::new(json!({"type": "FeatureCollection", "features": []}).to_string()),
            previewed: RefCell::default(),
            ready: Cell::new(false),
            waiting: RefCell::default(),
            keep: RefCell::default(),
        });
        let me = FieldMap(inner);
        me.wire();
        Some(me)
    }

    fn listen(&self, name: &str, f: impl FnMut() + 'static) {
        let closure = Closure::<dyn FnMut()>::new(f);
        bridge::on(&self.0.map, name, closure.as_ref().unchecked_ref());
        self.0.keep.borrow_mut().push(closure);
    }

    fn wire(&self) {
        let me = self.clone();
        self.listen("style.load", move || me.install());
        // self-heal: a style swap that was superseded can end without a usable `style.load`
        let me = self.clone();
        self.listen("idle", move || {
            if bridge::is_style_loaded(&me.0.map) && !bridge::has_source(&me.0.map, style::TILES) {
                me.install();
            }
        });
        // field work must survive a basemap outage: a style that cannot be fetched falls back to the plain background
        let me = self.clone();
        let on_error = Closure::<dyn FnMut(String, f64, bool)>::new(move |kind: String, status: f64, is_style: bool| {
            flyermap_diag::count("map.errors", 1);
            flyermap_diag::diag!(flyermap_diag::Level::Warn, "map", code "map.error", "map error", kind = kind.as_str(), status = status as i64);
            if is_style && !me.0.fallback.get() {
                me.0.fallback.set(true);
                flyermap_diag::count("map.styleFallback", 1);
                bridge::set_style(&me.0.map, &style::blank_style(me.0.theme.get()));
            }
        });
        bridge::on(&self.0.map, "error", on_error.as_ref().unchecked_ref());
        on_error.forget();
    }

    /// Runs after every style load: our sources and layers, the outlines; then whoever waited for the map.
    fn install(&self) {
        let map = &self.0.map;
        if bridge::has_source(map, style::TILES) {
            return;
        }
        bridge::hide_symbols(map, "oneway|one-way|arrow");
        for (id, spec) in style::sources(&self.tile_url()) {
            let _ = bridge::add_source(map, id, &spec.to_string());
        }
        for layer in style::layers(self.0.theme.get(), self.0.houses_only.get()) {
            let _ = bridge::add_layer(map, &layer.to_string());
        }
        bridge::set_data(map, style::AREAS, &self.0.areas.borrow());
        bridge::set_data(map, style::CONTEXT, &self.0.context.borrow());
        self.0.previewed.borrow_mut().clear();
        self.0.ready.set(true);
        let waiting: Vec<_> = self.0.waiting.borrow_mut().drain(..).collect();
        for f in waiting {
            f();
        }
    }

    /// `f` runs once our layers are on the map (at once when they are).
    pub fn when_ready(&self, f: impl FnOnce() + 'static) {
        if self.0.ready.get() && bridge::has_source(&self.0.map, style::TILES) {
            f();
        } else {
            self.0.waiting.borrow_mut().push(Box::new(f));
        }
    }

    fn tile_url(&self) -> String {
        format!("v5t://{}/{{z}}/{{x}}/{{y}}?v={}", self.0.token, self.0.tile_version.get())
    }

    fn style_now(&self) -> String {
        let theme = self.0.theme.get();
        let b = self.0.basemap.borrow();
        let chosen = if theme == Theme::Dark { b.dark.clone() } else { b.light.clone() };
        chosen.filter(|_| self.0.base_visible.get()).unwrap_or_else(|| style::blank_style(theme))
    }

    fn restyle(&self) {
        self.0.fallback.set(false);
        self.0.ready.set(false);
        bridge::set_style(&self.0.map, &self.style_now());
    }

    pub fn set_basemap(&self, basemap: Basemap) {
        if *self.0.basemap.borrow() == basemap {
            return;
        }
        *self.0.basemap.borrow_mut() = basemap;
        self.restyle();
    }

    pub fn set_theme(&self, theme: Theme) {
        if theme != self.0.theme.get() {
            self.0.theme.set(theme);
            self.restyle();
        }
    }

    /// "Karte aus": the plain background only.
    pub fn set_basemap_visible(&self, visible: bool) {
        if visible != self.0.base_visible.get() {
            self.0.base_visible.set(visible);
            self.restyle();
        }
    }

    /// Tiles from now on come from `provider` (z, x, y → Promise of bytes); the source drops what it cached.
    pub fn set_tiles(&self, provider: &js_sys::Function) {
        bridge::set_tile_provider(&self.0.token, provider);
        self.0.tile_version.set(self.0.tile_version.get() + 1);
        bridge::clear_states(&self.0.map, style::TILES);
        bridge::set_tiles(&self.0.map, style::TILES, &self.tile_url());
    }

    pub fn set_houses_only(&self, on: bool) {
        if on == self.0.houses_only.replace(on) {
            return;
        }
        for id in style::SEGMENT_LAYERS {
            bridge::set_filter(&self.0.map, id, Some(&style::segment_filter(id, on).to_string()));
        }
    }

    /// Paint changed statuses at once (the tiles to come carry them from the engine).
    pub fn paint(&self, changes: &[(Key, Status)]) -> u32 {
        let mut n = 0;
        for status in Status::ALL {
            let keys: Vec<&str> = changes.iter().filter(|(_, s)| *s == status).map(|(k, _)| k.as_str()).collect();
            if !keys.is_empty() {
                n += bridge::set_state(&self.0.map, style::TILES, &keys.join("\n"), "status", &JsValue::from_str(status.as_str()));
            }
        }
        flyermap_diag::count("map.painted", u64::from(n));
        n
    }

    /// Highlight what a tool is about to change, without touching status.
    pub fn set_preview(&self, keys: &[Key]) {
        let next: HashSet<Key> = keys.iter().cloned().collect();
        let mut previewed = self.0.previewed.borrow_mut();
        let off: Vec<&str> = previewed.difference(&next).map(Key::as_str).collect();
        let on: Vec<&str> = next.difference(&previewed).map(Key::as_str).collect();
        if !off.is_empty() {
            bridge::set_state(&self.0.map, style::TILES, &off.join("\n"), "preview", &JsValue::FALSE);
        }
        if !on.is_empty() {
            bridge::set_state(&self.0.map, style::TILES, &on.join("\n"), "preview", &JsValue::TRUE);
        }
        *previewed = next;
    }

    /// The Gebiete (GeoJSON features with `color` and `active`) and the outlines of the others.
    pub fn set_outlines(&self, areas: String, context: String) {
        bridge::set_data(&self.0.map, style::AREAS, &areas);
        bridge::set_data(&self.0.map, style::CONTEXT, &context);
        *self.0.areas.borrow_mut() = areas;
        *self.0.context.borrow_mut() = context;
    }

    pub fn token(&self) -> &str {
        &self.0.token
    }
}
