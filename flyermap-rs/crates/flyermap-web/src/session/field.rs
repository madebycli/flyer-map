//! The session loads the field (map data of the Gebiete the person may read) after the start; then the store and the sync open on it (`store.rs`).
use super::{core::Session, progress::Tracker};
use crate::{
    field::{self, Field},
    map::FieldMap,
    sync::{SyncHost, Triggers},
};
use flyermap_identity::Action;
use leptos::{prelude::*, task::spawn_local};
use std::{cell::RefCell, rc::Rc};

/// Where loading the map data is.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum FieldState {
    #[default]
    Idle,
    Loading {
        done: usize,
        total: usize,
    },
    Ready,
    Failed {
        message: String,
        code: String,
    },
}

/// What is alive once the field is loaded: the engine and the index (inside the field), the progress counters, the store with its sync, and the
/// page triggers of the sync (they stop when this is dropped).
pub struct Loaded {
    pub field: Rc<Field>,
    pub tracker: Rc<RefCell<Tracker>>,
    pub host: SyncHost,
    pub _triggers: Triggers,
}

impl Session {
    /// Fetch, unpack and derive the map data of the Gebiete the person may read. Runs again after the Gebiete changed.
    pub fn load_field(&self) {
        let me = *self;
        me.field_state.set(FieldState::Loading { done: 0, total: 0 });
        spawn_local(async move {
            let (plan, may_build) = me.world.with_untracked(|w| {
                me.rights
                    .with_untracked(|r| (field::plan(w, r), r.can_aktion(Action::ManageAktion) || w.gebiete.iter().any(|g| r.can_gebiet(Action::DrawArea, g))))
            });
            let total = plan.units.len();
            let on_progress = move |done, total| me.field_state.set(FieldState::Loading { done, total });
            match field::load::load(me.backend(), &plan, may_build, on_progress).await {
                Ok(field) => {
                    if !field.missing.is_empty() {
                        flyermap_diag::diag!(flyermap_diag::Level::Warn, "field", code "field.pack.missing", "map data is missing", gebiete = field.missing.len() as i64);
                    }
                    flyermap_diag::gauge("field.units", total as f64);
                    if let Some(old) = me.loaded.get_untracked() {
                        old.host.dispose();
                    }
                    let loaded = me.open_store(field).await;
                    me.loaded.set(Some(Rc::new(loaded)));
                    me.field_state.set(FieldState::Ready);
                }
                Err(e) => {
                    flyermap_diag::diag!(flyermap_diag::Level::Error, "field", code "field.load.failed", "loading the map data failed", reason = e.code().as_str());
                    me.field_state.set(FieldState::Failed { message: e.message(), code: e.code() });
                }
            }
        });
    }

    /// The map, once it exists (the map view creates it).
    pub fn field_map(&self) -> Option<FieldMap> {
        self.map.get_untracked()
    }
}
