//! The marking tool wired to the app: what a tap on the map means, applying a marking (rights, confirmation, undo), the route the engine finds for the
//! points, the preview of what the next confirm would mark, and the finger driver of the map. The rules themselves are in `crate::marking` (pure).
use super::state::AppState;
use crate::{
    features::mode::tools::{Brush, Lasso, ToolCtx, ToolView},
    map::{ink::InkCanvas, pointer::PointerDriver, query::Tapped, FieldMap},
    marking::{applied_text, model, route_facts, route_keys, ConfirmKind, MarkAction, Mode, PanelModel, RouteFacts},
    platform::{storage::KeyValue, LocalStore},
    shell::{Action, Tool},
    ui::status::{self, Kind},
};
use flyermap_core::{Key, Status};
use flyermap_identity::Art;
use leptos::{prelude::*, task::spawn_local};
use std::rc::Rc;

/// How many markings can be taken back one after the other.
const UNDO_DEPTH: usize = 30;

fn kind_of(state: AppState) -> Kind {
    if state.session.world.with_untracked(|w| w.aktion.art == Art::Abholen) {
        Kind::Collection
    } else {
        Kind::Distribution
    }
}

/// Set `status` on `keys`: the store, the map, the queue and the sync follow (`Session::mark`); the device confirms with a buzz or a tone, and the marking
/// can be taken back. Answers how many keys changed.
pub fn apply(state: AppState, keys: Vec<Key>, status: Status) -> usize {
    let applied = state.session.mark(&keys, status);
    let n = applied.count();
    if n == 0 {
        if !keys.is_empty() {
            let known = state.session.loaded.get_untracked().is_some_and(|l| keys.iter().any(|k| l.field.area_of.contains_key(k)));
            state.notify(if known { "Das ist schon so markiert, oder du darfst hier nichts ändern." } else { "Hier gibt es nichts zu markieren." });
        }
        return 0;
    }
    state.prefs.confirm();
    let label = status::label(kind_of(state), status);
    let changed: Vec<&Key> = applied.ops.iter().map(|o| &o.key).collect();
    flyermap_diag::breadcrumb("mark.applied", Some(n as i64));
    // one marking of a single house is the stamp's everyday: no note for that, the buzz and the pill say it
    if n > 1 {
        state.notify(applied_text(&changed, label));
    }
    state.undo.update(|u| {
        u.push(applied);
        if u.len() > UNDO_DEPTH {
            u.remove(0);
        }
    });
    n
}

/// The keys the confirm of Strecke would set now.
fn pending_keys(state: AppState) -> Vec<Key> {
    let Some(loaded) = state.session.loaded.get_untracked() else { return Vec::new() };
    let route = state.route.get_untracked();
    state.mark.with_untracked(|m| route_keys(&loaded.field.index, route.as_ref(), m))
}

/// The panel's model for the screen.
pub fn panel_model(state: AppState) -> Signal<PanelModel> {
    Signal::derive(move || {
        let route = state.route.get();
        let can_undo = state.undo.with(|u| !u.is_empty());
        let loaded = state.session.loaded.get();
        let kind = if state.session.world.with(|w| w.aktion.art == Art::Abholen) { Kind::Collection } else { Kind::Distribution };
        state.mark.with(|m| {
            let facts = loaded.map_or(RouteFacts::default(), |l| route_facts(&route_keys(&l.field.index, route.as_ref(), m), route.as_ref()));
            model(m, route.as_ref(), facts, kind, can_undo)
        })
    })
}

/// The confirm button: Strecke sets the status on the selection and stays ready for the next route; every other mode ends the marking.
pub fn confirm(state: AppState) {
    let kind = state.mark.with_untracked(|m| model(m, None, RouteFacts::default(), Kind::Distribution, false).confirm_kind);
    match kind {
        ConfirmKind::Finish => state.dispatch(Action::SetTool(Tool::Idle)),
        ConfirmKind::Apply => {
            let keys = pending_keys(state);
            let status = state.mark.with_untracked(|m| m.status);
            if !keys.is_empty() && apply(state, keys, status) > 0 {
                state.mark.update(|m| m.reduce(MarkAction::ClearTaps));
            }
        }
    }
}

/// The undo button: the last point of a route, else the last marking.
pub fn undo(state: AppState) {
    let route_points = state.mark.with_untracked(|m| m.mode == Mode::Route && !m.taps.is_empty());
    if route_points {
        state.mark.update(|m| m.reduce(MarkAction::UndoTap));
        return;
    }
    let mut last = None;
    state.undo.update(|u| last = u.pop());
    if let Some(applied) = last {
        state.session.undo(&applied);
        state.notify("Markierung zurückgenommen.");
    }
}

/// A tap on the map while the marking panel is up (Stempeln and Strecke; Wischen and Lasso work with the finger driver).
pub fn tap(state: AppState, map: &FieldMap, p: [f64; 2]) {
    let Some(loaded) = state.session.loaded.get_untracked() else { return };
    let mark = state.mark.get_untracked();
    if !matches!(mark.mode, Mode::Stamp | Mode::Route) {
        return;
    }
    let Some(hit) = map.tapped(p, mark.mode == Mode::Route) else { return };
    match (mark.mode, hit) {
        (Mode::Stamp, Tapped::House(id)) => {
            apply(state, vec![Key::house(&id)], mark.status);
        }
        (Mode::Stamp, Tapped::Segment(id)) => {
            let keys = loaded.field.index.keys_for_groups([id.as_str()], mark.with_houses, mark.houses_only);
            apply(state, keys, mark.status);
        }
        (_, Tapped::Segment(id)) => state.mark.update(|m| m.reduce(MarkAction::TapSegment(id))),
        (_, Tapped::House(id)) => state.mark.update(|m| m.reduce(MarkAction::TapHouse(id))),
    }
}

/// The effects of the tool: persistence of the choices, the finger driver and its tool, the route, the preview, the "only streets with houses" filter.
pub fn install(state: AppState) {
    let s = state.session;
    let tool = state.tool();
    // the choices (not the points) stay on the device
    Effect::new(move |_| {
        let saved = state.mark.with(|m| m.to_saved());
        let _ = LocalStore.write(crate::marking::SAVED_KEY, &saved);
    });
    // the finger driver and the ink exist once the map does
    let ink: StoredValue<Option<Rc<InkCanvas>>, LocalStorage> = StoredValue::new_local(None);
    Effect::new(move |_| {
        let Some(map) = s.map.get() else { return };
        if state.driver.with_value(|d| d.is_some()) {
            return;
        }
        let haptics = state.prefs.haptics;
        let driver = PointerDriver::attach(&map, move || {
            crate::platform::vibrate::tick(haptics.get_untracked());
        });
        state.driver.set_value(Some(Rc::new(driver)));
        ink.set_value(InkCanvas::new(&map.container()).map(Rc::new));
    });
    // the tool that may take a finger: Wischen or Lasso while the panel is up; otherwise none
    Effect::new(move |_| {
        let (Some(map), Some(loaded)) = (s.map.get(), s.loaded.get()) else { return };
        let (active, mode) = (tool.get() == Tool::Mark, state.mark.with(|m| m.mode));
        let Some(driver) = state.driver.get_value() else { return };
        let Some(ink) = ink.get_value() else { return };
        let ctx = |ink: Rc<InkCanvas>| {
            Rc::new(ToolCtx {
                map: map.clone(),
                ink,
                field: Rc::clone(&loaded.field),
                view: Box::new(move || ToolView { state: state.mark.get_untracked(), theme: state.prefs.theme.get_untracked() }),
                apply: Box::new(move |keys, status| {
                    apply(state, keys, status);
                }),
            })
        };
        let chosen: Option<Box<dyn crate::map::gesture::Tool>> = match (active, mode) {
            (true, Mode::Brush) => Some(Box::new(Brush::new(ctx(ink)))),
            (true, Mode::Lasso) => Some(Box::new(Lasso::new(ctx(ink)))),
            _ => None,
        };
        driver.set_tool(chosen);
        if !active {
            // only when there is something to clear: writing what this effect reads would run it again and again
            if state.mark.with_untracked(|m| !m.taps.is_empty()) {
                state.mark.update(|m| m.reduce(MarkAction::ClearTaps));
            }
        }
    });
    // the route for the street pieces tapped (the engine answers a moment later; an answer for points that are gone is dropped)
    Effect::new(move |_| {
        let (active, mode, anchors) = (tool.get() == Tool::Mark, state.mark.with(|m| m.mode), state.mark.with(|m| m.anchors()));
        let Some(loaded) = s.loaded.get() else { return };
        if !active || mode != Mode::Route || anchors.is_empty() {
            state.route.set(None);
            return;
        }
        let engine = Rc::clone(&loaded.field.engine);
        spawn_local(async move {
            let found = engine.route(&anchors).await.ok();
            if state.mark.with_untracked(|m| m.anchors()) == anchors {
                state.route.set(found);
            }
        });
    });
    // the glow: what the confirm of Strecke would mark, or else the thing whose sheet is open
    Effect::new(move |_| {
        let Some(map) = s.map.get() else { return };
        let keys = if tool.get() == Tool::Mark {
            if state.mark.with(|m| m.mode == Mode::Route) {
                pending_keys_tracked(state)
            } else {
                Vec::new()
            }
        } else {
            super::object::highlighted(state)
        };
        map.set_preview(&keys);
    });
    // "only streets with houses" hides the others on the map
    Effect::new(move |_| {
        if let Some(map) = s.map.get() {
            map.set_houses_only(state.mark.with(|m| m.houses_only));
        }
    });
}

/// Like `pending_keys` but reading (and so depending on) the signals.
fn pending_keys_tracked(state: AppState) -> Vec<Key> {
    let Some(loaded) = state.session.loaded.get() else { return Vec::new() };
    let route = state.route.get();
    state.mark.with(|m| route_keys(&loaded.field.index, route.as_ref(), m))
}
