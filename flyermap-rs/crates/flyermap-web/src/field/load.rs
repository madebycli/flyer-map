//! Loading the map data: fetch the packs of the units, unpack them, let the engine derive streets and houses, merge the Gebiete into one field.
//! The engine keeps the geometry (it leaves as vector tiles); the app keeps the coordinate-free network and the index for marking.
use super::{index::Index, merge::merge, units::Plan};
use crate::{
    backend::{Backend, BackendError},
    engine::{Engine, EngineError},
    platform::gunzip::gunzip,
};
use flyermap_core::Key;
use js_sys::Uint8Array;
use std::{collections::HashMap, rc::Rc};

/// Where the engine worker's script is (next to `index.html`).
pub const ENGINE_WORKER: &str = "engine-worker.js";

/// Everything derived from the packs of one start.
pub struct Field {
    pub engine: Rc<Engine>,
    pub index: Index,
    /// The Gebiet of every house and street piece: what each edit is sent with.
    pub area_of: HashMap<Key, String>,
    /// Keys of all houses and the length of every visible street piece, for the progress counters.
    pub houses: Vec<Key>,
    pub segments: Vec<(Key, f64)>,
    /// Gebiete whose map data does not exist (yet) or could not be had.
    pub missing: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum FieldError {
    #[error("the engine could not be started")]
    NoEngine,
    #[error("backend: {0}")]
    Backend(#[from] BackendError),
    #[error("engine: {0}")]
    Engine(#[from] EngineError),
    #[error("a pack could not be unpacked")]
    BadPack,
}

impl FieldError {
    pub fn message(&self) -> String {
        match self {
            FieldError::NoEngine => "Die Karten-Engine konnte nicht gestartet werden. Lade die Seite neu.".into(),
            FieldError::Backend(e) => e.message(),
            FieldError::Engine(_) | FieldError::BadPack => "Die Kartendaten konnten nicht gelesen werden.".into(),
        }
    }

    pub fn code(&self) -> String {
        match self {
            FieldError::NoEngine => "engine.start".into(),
            FieldError::Backend(e) => e.code(),
            FieldError::Engine(e) => e.code().to_string(),
            FieldError::BadPack => "pack.unpack".into(),
        }
    }
}

/// `progress(done, total)` is called before each unit. `may_build`: the person may ask the server to build missing map data.
pub async fn load(backend: Rc<dyn Backend>, plan: &Plan, may_build: bool, progress: impl Fn(usize, usize)) -> Result<Field, FieldError> {
    let engine = Rc::new(Engine::start(ENGINE_WORKER).ok_or(FieldError::NoEngine)?);
    engine.reset().await?;
    let (mut parts, mut missing) = (Vec::new(), Vec::new());
    for (i, unit) in plan.units.iter().enumerate() {
        progress(i, plan.units.len());
        let which = unit.pack_ref();
        let mut bytes = backend.pack(&which).await?;
        if bytes.is_none() && may_build && backend.build_pack(&which).await.is_ok() {
            bytes = backend.pack(&which).await?;
        }
        let Some(bytes) = bytes else {
            missing.push(unit.gebiet.clone());
            continue;
        };
        let raw = gunzip(&Uint8Array::from(bytes.as_slice())).await.ok_or(FieldError::BadPack)?;
        let network = engine.add_area(raw, &unit.ring, unit.cell).await?;
        parts.push((unit.gebiet.clone(), network));
    }
    progress(plan.units.len(), plan.units.len());
    let merged = merge(parts);
    let houses = merged.network.houses.iter().map(|h| Key::house(&h.id)).collect();
    let segments = merged.network.segments.iter().filter(|s| s.visible).map(|s| (Key::segment(&s.id), s.length)).collect();
    let index = Index::new(&merged.network);
    missing.sort();
    missing.dedup();
    Ok(Field { engine, index, area_of: merged.area_of, houses, segments, missing })
}
