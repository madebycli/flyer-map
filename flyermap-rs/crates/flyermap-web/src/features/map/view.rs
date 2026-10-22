//! The map zone: creates the MapLibre map once (through the bridge), then keeps it in step with the world, the settings and the loaded field.
//! It owns no data. A tap on the map is handed to the app (what is under the finger depends on the tool in use).
use super::{geojson, tiles};
use crate::{
    app::{acts::open_subject, state::AppState},
    map::{bridge, FieldMap},
    model::Subject,
    shell::Tool,
};
use leptos::{html, prelude::*, task::spawn_local};
use std::cell::Cell;

/// Where the map starts when there is nothing to show yet.
const FALLBACK_CENTER: [f64; 2] = [13.0, 51.2];
const FIT_PADDING: f64 = 70.0;

/// A tap with no tool in use: the Gebiet under the finger opens its sheet.
fn on_tap(state: AppState, map: &FieldMap, p: [f64; 2]) {
    if state.shell.with_untracked(|s| s.tool) != Tool::Idle {
        return;
    }
    let at = map.unproject(p);
    let gebiet = state.session.world.with_untracked(|w| w.gebiet_at(at).map(|g| g.id.clone()));
    if let Some(id) = gebiet {
        open_subject(state, Subject::Gebiet(id));
    }
}

#[component]
pub fn MapView(state: AppState) -> impl IntoView {
    let s = state.session;
    let host = NodeRef::<html::Div>::new();

    // create the map once its element exists
    Effect::new(move |created: Option<bool>| {
        if created == Some(true) {
            return true;
        }
        let Some(element) = host.get() else { return false };
        let theme = state.prefs.theme.get_untracked();
        let center = s.world.with_untracked(|w| w.bounds().map(|b| [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0])).unwrap_or(FALLBACK_CENTER);
        spawn_local(async move {
            if bridge::load().await.is_err() {
                flyermap_diag::diag!(flyermap_diag::Level::Error, "map", code "map.load.failed", "MapLibre could not be loaded");
                return;
            }
            if let Some(map) = FieldMap::create(&element, theme, center, 14.0) {
                let tapped = map.clone();
                map.on_click(move |p| on_tap(state, &tapped, p));
                s.map.set(Some(map));
            }
        });
        true
    });

    // look: theme, base map, outlines
    Effect::new(move |_| {
        if let Some(map) = s.map.get() {
            map.set_theme(state.prefs.theme.get());
        }
    });
    Effect::new(move |_| {
        if let Some(map) = s.map.get() {
            map.set_basemap_visible(state.prefs.base_on.get());
        }
    });
    Effect::new(move |_| {
        let Some(map) = s.map.get() else { return };
        let (areas, context, basemap) = s.world.with(|w| {
            let active = |g: &crate::model::Gebiet| s.rights.with_untracked(|r| r.can_gebiet(flyermap_identity::Action::Mark, g));
            (geojson::areas(&w.gebiete, &active), geojson::context(&w.context), w.basemap.clone())
        });
        map.set_basemap(basemap);
        map.set_outlines(areas, context);
    });

    // data: the tiles come from the engine of the loaded field; the first time the camera goes to the Gebiete
    let fitted = StoredValue::new_local(Cell::new(false));
    Effect::new(move |_| {
        let (Some(map), Some(loaded)) = (s.map.get(), s.loaded.get()) else { return };
        let provider = tiles::provider(loaded.field.engine.clone());
        let m = map.clone();
        map.when_ready(move || m.set_tiles(&provider));
    });
    Effect::new(move |_| {
        let Some(map) = s.map.get() else { return };
        if fitted.with_value(|f| f.replace(true)) {
            return;
        }
        if let Some(bounds) = s.world.with_untracked(|w| w.bounds()) {
            map.fit(bounds, FIT_PADDING);
        }
    });

    // following a Lauf: the camera goes to its Gebiet
    Effect::new(move |_| {
        let (Some(map), Some(id)) = (s.map.get(), state.following.get()) else { return };
        let bounds = s.world.with_untracked(|w| w.lauf(&id).and_then(|l| w.gebiet(&l.gebiet)).and_then(|g| crate::model::ring_bounds(&g.ring)));
        if let Some(b) = bounds {
            map.fit(b, FIT_PADDING);
        }
    });

    view! { <div node_ref=host class="v5-map" aria-label="Karte" data-fm-map></div> }
}
