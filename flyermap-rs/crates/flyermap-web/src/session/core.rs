//! The session: the backend, the answers of its boot, and the numbers the screens keep showing (progress, the state of the sync).
use super::field::{FieldState, Loaded};
use crate::map::FieldMap;
use crate::{
    backend::{Backend, BackendError},
    model::{Rights, World},
    platform::time::now_ms,
    sync::SyncView,
};
use flyermap_core::ProgressSnapshot;
use flyermap_identity::AktionId;
use leptos::{prelude::*, task::spawn_local};
use std::{collections::HashMap, rc::Rc};

/// Where the start is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    Starting,
    /// This device has no access yet: it has to join (invitation) or sign in.
    NeedsJoin,
    Ready,
    /// The start failed for another reason: the sentence and the stable code.
    Failed {
        message: String,
        code: String,
    },
}

#[derive(Clone, Copy)]
pub struct Session {
    pub backend: StoredValue<Rc<dyn Backend>, LocalStorage>,
    pub phase: RwSignal<Phase>,
    pub world: RwSignal<World>,
    pub rights: RwSignal<Rights>,
    /// Houses and metres per status, by Gebiet (what the overview and the pill show).
    pub progress: RwSignal<HashMap<String, ProgressSnapshot>>,
    /// Counts every change of a status (from this device or from the server): a screen that shows a status reads it to know when to look again.
    pub changed: RwSignal<u64>,
    /// Names of the lists the connection does not serve ("Personen", "Zugänge"): the Studio says so instead of showing them empty.
    pub missing: RwSignal<Vec<String>>,
    pub sync: RwSignal<SyncView>,
    /// The loaded map data (engine, network, marking index) once there is some.
    pub loaded: RwSignal<Option<Rc<Loaded>>, LocalStorage>,
    pub field_state: RwSignal<FieldState>,
    /// The map, once the map view has created it.
    pub map: RwSignal<Option<FieldMap>, LocalStorage>,
}

impl Session {
    pub fn new(backend: Rc<dyn Backend>) -> Session {
        Session {
            backend: StoredValue::new_local(backend),
            phase: RwSignal::new(Phase::Starting),
            world: RwSignal::new(World::empty()),
            rights: RwSignal::new(Rights::none()),
            progress: RwSignal::new(HashMap::new()),
            changed: RwSignal::new(0),
            missing: RwSignal::new(Vec::new()),
            sync: RwSignal::new(SyncView::default()),
            loaded: RwSignal::new_local(None),
            field_state: RwSignal::new(FieldState::Idle),
            map: RwSignal::new_local(None),
        }
    }

    pub fn backend(&self) -> Rc<dyn Backend> {
        self.backend.get_value()
    }

    /// Ask the backend for the Aktion and, with it, what this device may do. Runs again after joining.
    pub fn start(&self) {
        let me = *self;
        me.phase.set(Phase::Starting);
        spawn_local(async move {
            match me.backend().boot().await {
                Ok(boot) => {
                    let aktion = AktionId::new(&boot.world.aktion.id);
                    me.rights.set(Rights::new(boot.grants, boot.org, aktion, now_ms()));
                    me.world.set(boot.world);
                    me.phase.set(Phase::Ready);
                    me.load_field();
                }
                Err(BackendError::Unauthorized) => me.phase.set(Phase::NeedsJoin),
                Err(e) => {
                    flyermap_diag::diag!(flyermap_diag::Level::Error, "session", code "session.boot.failed", "the start failed", reason = e.code().as_str());
                    me.phase.set(Phase::Failed { message: e.message(), code: e.code() });
                }
            }
        });
    }
}
