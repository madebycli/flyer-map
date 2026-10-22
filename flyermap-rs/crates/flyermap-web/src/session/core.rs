//! The session: the backend, the answers of its boot, and the numbers the screens keep showing (progress, the state of the sync).
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
    pub sync: RwSignal<SyncView>,
}

impl Session {
    pub fn new(backend: Rc<dyn Backend>) -> Session {
        Session {
            backend: StoredValue::new_local(backend),
            phase: RwSignal::new(Phase::Starting),
            world: RwSignal::new(World::empty()),
            rights: RwSignal::new(Rights::none()),
            progress: RwSignal::new(HashMap::new()),
            sync: RwSignal::new(SyncView::default()),
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
