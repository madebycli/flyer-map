//! The one seam between the screens and the data. The interface knows only [`Backend`]; what stands behind it can change without touching a
//! screen: [`mock::MockBackend`] (made-up Aktion in memory, for design and tests), [`v5::V5Backend`] (the `/api/v5` bridge of the Rust Worker:
//! real data until the new server exists) and, later, the v6 server. Methods return boxed futures so the trait is object safe (`Rc<dyn Backend>`)
//! and the app holds one without being generic over it.
pub mod error;
pub mod mock;
pub mod types;
pub mod v5;

pub use error::BackendError;
pub use types::{Boot, GebietDraft, Joined, PackRef, SignIn};

use crate::model::{Gebiet, Lauf, Person, Zugang};
use flyermap_sync::NetError;
use flyermap_wire::{PushResponse, StatePage, WireOp};
use std::{future::Future, pin::Pin};

/// A future that is not `Send`: the app runs on the browser's one thread.
pub type Fut<T> = Pin<Box<dyn Future<Output = T> + 'static>>;

pub fn ready<T: 'static>(value: T) -> Fut<T> {
    Box::pin(std::future::ready(value))
}

pub trait Backend {
    /// `"mock"` or `"v5"`: for the diagnostics, never for decisions.
    fn name(&self) -> &'static str;

    /// Everything the app needs to start: the Aktion, its Gebiete and Gruppen, the person's grants.
    fn boot(&self) -> Fut<Result<Boot, BackendError>>;

    /// The map data of a Gebiet (or one part of a big one) as the gzip bytes of a pack; `None` when none was built yet.
    fn pack(&self, which: &PackRef) -> Fut<Result<Option<Vec<u8>>, BackendError>>;

    /// Ask the server to build the map data of a Gebiet (needs the right to).
    fn build_pack(&self, _which: &PackRef) -> Fut<Result<(), BackendError>> {
        ready(Err(BackendError::Unsupported("Kartendaten bauen")))
    }

    /// The sync loop's two calls (`flyermap_sync::Machine` decides when).
    fn push(&self, ops: Vec<WireOp>) -> Fut<Result<PushResponse, NetError>>;
    fn pull(&self, since: u64) -> Fut<Result<StatePage, NetError>>;

    /// Who is out right now (the live strip).
    fn laeufe(&self) -> Fut<Result<Vec<Lauf>, BackendError>> {
        ready(Ok(Vec::new()))
    }

    fn personen(&self) -> Fut<Result<Vec<Person>, BackendError>> {
        ready(Err(BackendError::Unsupported("Personen")))
    }

    fn zugaenge(&self) -> Fut<Result<Vec<Zugang>, BackendError>> {
        ready(Err(BackendError::Unsupported("Zugänge")))
    }

    /// Save drawn Gebiete (new ones, grown ones, neighbours that got new corners) in one step; answers the Gebiete as stored.
    fn save_gebiete(&self, _drafts: Vec<GebietDraft>) -> Fut<Result<Vec<Gebiet>, BackendError>> {
        ready(Err(BackendError::Unsupported("Gebiete speichern")))
    }

    /// Redeem an invitation code (or QR / link): the device becomes a guest or joins with its account.
    fn redeem(&self, _code: &str) -> Fut<Result<Joined, BackendError>> {
        ready(Err(BackendError::Unsupported("Einladung einlösen")))
    }

    fn sign_in(&self, _how: SignIn) -> Fut<Result<Joined, BackendError>> {
        ready(Err(BackendError::Unsupported("Anmelden")))
    }
}

/// The answer of a future that is ready at once (the mock's are): for native tests, which have no event loop.
#[cfg(test)]
pub fn now<T>(mut f: Fut<T>) -> T {
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    match f.as_mut().poll(&mut cx) {
        std::task::Poll::Ready(v) => v,
        std::task::Poll::Pending => panic!("the future was not ready at once"),
    }
}
