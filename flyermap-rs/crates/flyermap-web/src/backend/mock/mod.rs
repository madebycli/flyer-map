//! A backend that needs no network: an invented Aktion in memory, real map data made on the fly from a synthetic neighbourhood, and a log that
//! numbers edits like the server. For the design work (every role, every screen), for tests, and for trying the app on a plane.
//! Which persona it plays comes from the page address (`?mock=member`, see [`data::Persona`]).
pub mod data;
pub mod pack;
pub mod server;
pub mod synth;

use super::{ready, Backend, BackendError, Boot, Fut, GebietDraft, Joined, PackRef};
use crate::model::{Gebiet, Lauf, Person, World, Zugang};
use data::Persona;
use flyermap_identity::OrgId;
use flyermap_sync::NetError;
use flyermap_wire::{PushResponse, StatePage, WireOp};
use std::{cell::RefCell, rc::Rc};

const PAGE: usize = 1000;

struct State {
    persona: Persona,
    joined: bool,
    world: World,
    log: server::Log,
    saved: u32,
}

#[derive(Clone)]
pub struct MockBackend {
    state: Rc<RefCell<State>>,
    now: Rc<dyn Fn() -> u64>,
}

impl MockBackend {
    pub fn new(persona: Persona, now: impl Fn() -> u64 + 'static) -> MockBackend {
        let state = State { persona, joined: persona != Persona::Stranger, world: data::world(persona), log: server::Log::default(), saved: 0 };
        MockBackend { state: Rc::new(RefCell::new(state)), now: Rc::new(now) }
    }

    /// The persona the page address asks for.
    pub fn persona_from(search: &str) -> Persona {
        search.trim_start_matches('?').split('&').find_map(|pair| pair.strip_prefix("mock=")).map(Persona::parse).unwrap_or_default()
    }

    /// How many edits the log holds (for the tests and the diagnostics).
    pub fn logged(&self) -> usize {
        self.state.borrow().log.len()
    }

    fn effective(&self) -> Persona {
        let s = self.state.borrow();
        if s.joined {
            if s.persona == Persona::Stranger {
                Persona::Member
            } else {
                s.persona
            }
        } else {
            Persona::Stranger
        }
    }
}

impl Backend for MockBackend {
    fn name(&self) -> &'static str {
        "mock"
    }

    fn boot(&self) -> Fut<Result<Boot, BackendError>> {
        let persona = self.effective();
        if persona == Persona::Stranger {
            return ready(Err(BackendError::Unauthorized));
        }
        let mut s = self.state.borrow_mut();
        // gebiete the person may write in follow the persona (a guest joined as a member of Gruppe Nord)
        let fresh = data::gebiete(persona);
        for g in &mut s.world.gebiete {
            if let Some(f) = fresh.iter().find(|f| f.id == g.id) {
                g.writable = f.writable;
            }
        }
        let mut world = s.world.clone();
        if s.persona == Persona::Stranger {
            world.me.label = Some("Gast 8".into());
            world.me.guest = true;
        }
        ready(Ok(Boot { world, grants: data::grants(persona), org: OrgId::new(data::ORG) }))
    }

    fn pack(&self, which: &PackRef) -> Fut<Result<Option<Vec<u8>>, BackendError>> {
        let gebiet = self.state.borrow().world.gebiet(&which.gebiet).cloned();
        ready(match gebiet {
            None => Err(BackendError::NotFound),
            Some(_) if which.part.is_some_and(|p| p > 0) => Ok(None),
            Some(g) => Ok(Some(pack::bytes(&g))),
        })
    }

    fn push(&self, ops: Vec<WireOp>) -> Fut<Result<PushResponse, NetError>> {
        let mut s = self.state.borrow_mut();
        let writable: Vec<String> = s.world.gebiete.iter().filter(|g| g.writable).map(|g| g.id.clone()).collect();
        ready(Ok(s.log.push(ops, "mock", &|area| writable.iter().any(|a| a == area))))
    }

    fn pull(&self, since: u64) -> Fut<Result<StatePage, NetError>> {
        ready(Ok(self.state.borrow().log.pull(since, PAGE, (self.now)())))
    }

    fn laeufe(&self) -> Fut<Result<Vec<Lauf>, BackendError>> {
        ready(Ok(self.state.borrow().world.laeufe.clone()))
    }

    fn personen(&self) -> Fut<Result<Vec<Person>, BackendError>> {
        ready(Ok(self.state.borrow().world.personen.clone()))
    }

    fn zugaenge(&self) -> Fut<Result<Vec<Zugang>, BackendError>> {
        ready(Ok(self.state.borrow().world.zugaenge.clone()))
    }

    fn save_gebiete(&self, drafts: Vec<GebietDraft>) -> Fut<Result<Vec<Gebiet>, BackendError>> {
        let mut s = self.state.borrow_mut();
        let mut stored = Vec::new();
        for d in drafts {
            let color = d.gruppe.as_deref().and_then(|id| s.world.gruppe(id)).map_or_else(|| "#6c7f92".to_string(), |g| g.color.clone());
            let id = d.id.clone().unwrap_or_else(|| {
                s.saved += 1;
                format!("gebiet-{}", s.saved)
            });
            let version = s.world.gebiet(&id).and_then(|g| g.pack_version).map_or(1, |v| v + 1);
            let gebiet =
                Gebiet { id: id.clone(), name: d.name, gruppe: d.gruppe, art: d.art, ring: d.ring, writable: true, pack_version: Some(version), color };
            match s.world.gebiete.iter_mut().find(|g| g.id == id) {
                Some(slot) => *slot = gebiet.clone(),
                None => s.world.gebiete.push(gebiet.clone()),
            }
            stored.push(gebiet);
        }
        ready(Ok(stored))
    }

    fn redeem(&self, code: &str) -> Fut<Result<Joined, BackendError>> {
        let invalid = |code: &str, message: &str| ready(Err(BackendError::Invalid { code: code.into(), message: message.into() }));
        match crate::features::join::normalize_code(code).as_str() {
            data::INVITE_CODE => {
                self.state.borrow_mut().joined = true;
                let name = self.state.borrow().world.aktion.name.clone();
                ready(Ok(Joined { label: "Gast 8".into(), guest: true, aktion_name: name }))
            }
            "0000000000" => invalid("invite_expired", "Diese Einladung ist abgelaufen. Bitte um eine neue."),
            "2222222222" => ready(Err(BackendError::Unavailable { code: "network".into(), message: "Keine Verbindung zum Server.".into() })),
            _ => invalid("invite_invalid", "Diesen Code kenne ich nicht. Prüfe ihn noch einmal."),
        }
    }
}
