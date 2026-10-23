//! The drawing tool wired to the app: start it (from the Studio, a command, the sheet of a Gebiet), what a tap on the map adds, what the drawing is now (the
//! verdict of `crate::drawing`), the preview on the map, confirm (a new Gebiet waits for its name in a sheet, a grown one is stored at once), and storing through the
//! backend. A refusal stays in words and the drawing stays, so nothing is lost. The rules are in `crate::drawing`; the screens are `app::draw_views`.
use super::{acts::fly_to, state::AppState};
use crate::{
    drawing::{drafts, evaluate, geojson, Areas, Draw, DrawAction, Kind, Reach, Ready, Verdict},
    map::FieldMap,
    model::Subject,
    shell::{Action, Panel, Tool},
};
use flyermap_identity::Action as Right;
use leptos::{prelude::*, task::spawn_local};

/// The Gebiete as the drawing counts them: in the order of the world, with what the person may change.
pub fn areas(state: AppState) -> Areas {
    let s = state.session;
    s.world.with(|w| {
        s.rights.with(|r| Areas {
            ids: w.gebiete.iter().map(|g| g.id.clone()).collect(),
            names: w.gebiete.iter().map(|g| g.name.clone()).collect(),
            rings: w.gebiete.iter().map(|g| g.ring.clone()).collect(),
            art: w.gebiete.iter().map(|g| g.art).collect(),
            changeable: w.gebiete.iter().map(|g| r.can_gebiet(Right::DrawArea, g)).collect(),
        })
    })
}

/// What the drawing is now.
pub fn verdict(state: AppState) -> Memo<Verdict> {
    Memo::new(move |_| {
        let areas = areas(state);
        state.draw.with(|d| evaluate(d, &areas))
    })
}

fn may_draw(state: AppState) -> bool {
    let s = state.session;
    s.world.with_untracked(|w| s.rights.with_untracked(|r| r.may_draw_somewhere(&w.gebiete)))
}

/// Start drawing: `target` is the Gebiet the drawing is aimed at (from its sheet), `gruppe` the Gruppe the new one is meant for.
pub fn start(state: AppState, kind: Kind, target: Option<String>, gruppe: Option<String>) {
    if !may_draw(state) {
        state.notify("Hier darfst du keine Gebiete zeichnen.");
        return;
    }
    state.draw.set(Draw { kind, target, gruppe, points: Vec::new() });
    state.saving.set(None);
    state.save_error.set(None);
    state.dispatch(Action::SetTool(Tool::Draw));
}

/// A tap on the map while drawing adds a point (snapped to a border when the kind needs one).
pub fn tap(state: AppState, map: &FieldMap, p: [f64; 2]) {
    let at = map.unproject(p);
    let view = map.view();
    let (zoom, lat) = (view.get(2).copied().unwrap_or(15.0), view.get(1).copied().unwrap_or(at[1]));
    let areas = areas(state);
    let target = state.draw.with_untracked(|d| d.target.as_deref().and_then(|t| areas.index_of(t)));
    state.draw.update(|d| d.reduce(DrawAction::Tap { at, reach: Reach::at(zoom, lat) }, &areas.rings, target));
}

pub fn set_kind(state: AppState, kind: Kind) {
    let areas = areas(state);
    state.draw.update(|d| {
        d.reduce(DrawAction::SetKind(kind), &areas.rings, None);
        // a drawing aimed at one Gebiet keeps its aim only for the kinds along a border
        if !kind.on_border() {
            d.target = None;
        }
    });
}

pub fn undo(state: AppState) {
    let areas = areas(state);
    state.draw.update(|d| d.reduce(DrawAction::Undo, &areas.rings, None));
}

fn ready_now(state: AppState) -> Option<Ready> {
    let areas = areas(state);
    match state.draw.with_untracked(|d| evaluate(d, &areas)) {
        Verdict::Ready(r) => Some(r),
        _ => None,
    }
}

/// The confirm button: a new Gebiet is named first (the sheet), a grown one is stored at once.
pub fn confirm(state: AppState) {
    let Some(ready) = ready_now(state) else { return };
    if ready.creates {
        state.save_error.set(None);
        state.dispatch(Action::Open(Panel::SaveGebiet));
        state.saving.set(Some(ready));
    } else {
        state.saving.set(Some(ready));
        save(state, String::new(), None);
    }
}

/// Back from the sheet to the drawing, as it was.
pub fn back_to_drawing(state: AppState) {
    state.saving.set(None);
    state.save_error.set(None);
    state.dispatch(Action::SetTool(Tool::Draw));
}

fn done_text(ready: &Ready, name: &str) -> String {
    match ready.kind {
        Kind::Extend => "Das Gebiet ist jetzt größer.".to_string(),
        Kind::Split => format!("Geteilt: „{name}“ ist ein neues Teilgebiet."),
        Kind::Free | Kind::Connect => format!("„{name}“ ist angelegt."),
    }
}

/// Store the drawing that waits (`saving`): the new Gebiet with `name` and `gruppe` and every neighbour that changed with it, in one step.
pub fn save(state: AppState, name: String, gruppe: Option<String>) {
    let s = state.session;
    let Some(ready) = state.saving.get_untracked() else { return };
    let (gebiete, art) = s.world.with_untracked(|w| (w.gebiete.clone(), w.aktion.art));
    let list = drafts(&ready, &gebiete, &name, gruppe.as_deref(), art);
    state.save_error.set(None);
    spawn_local(async move {
        match s.backend().save_gebiete(list).await {
            Ok(stored) => {
                let shown = stored.first().map(|g| g.id.clone());
                s.world.update(|w| {
                    for g in stored {
                        match w.gebiete.iter_mut().find(|x| x.id == g.id) {
                            Some(slot) => *slot = g,
                            None => w.gebiete.push(g),
                        }
                    }
                });
                s.load_field();
                state.draw.set(Draw::default());
                state.saving.set(None);
                state.dispatch(Action::SetTool(Tool::Idle));
                state.dispatch(Action::Close);
                state.notify(done_text(&ready, name.trim()));
                if let Some(id) = shown {
                    fly_to(state, &Subject::Gebiet(id));
                }
            }
            Err(e) => {
                // the sheet shows it; a grown Gebiet has no sheet, so a note says it
                if ready.creates {
                    state.save_error.set(Some(e.message()));
                } else {
                    state.saving.set(None);
                    state.notify(e.message());
                }
            }
        }
    });
}

/// The effects of the tool: the drawing on the map, and putting it away when the tool is put down (unless it waits for its name).
pub fn install(state: AppState) {
    let s = state.session;
    let tool = state.tool();
    let panel = state.panel();
    let verdict = verdict(state);
    Effect::new(move |_| {
        let Some(map) = s.map.get() else { return };
        let text = state.draw.with(|d| verdict.with(|v| geojson(d, v)));
        map.set_draw(text);
    });
    Effect::new(move |_| {
        let (tool, waiting) = (tool.get(), state.saving.with(Option::is_some));
        if tool != Tool::Draw && !waiting && state.draw.with_untracked(|d| !d.is_empty()) {
            state.draw.set(Draw::default());
        }
    });
    // the sheet was put away some other way than its buttons (Escape): the drawing is given up
    Effect::new(move |_| {
        let (panel, tool) = (panel.get(), tool.get());
        if panel != Some(Panel::SaveGebiet) && tool != Tool::Draw && state.saving.with_untracked(Option::is_some) {
            state.saving.set(None);
        }
    });
}
