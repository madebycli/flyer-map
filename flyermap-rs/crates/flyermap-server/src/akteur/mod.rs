//! The way from the edge to the Akteur of an Aktion (Plan 061 §1, §5). The edge works out who asks and may go in ([`crate::api::akteur`]); the Akteur
//! decides everything else. [`serve`] is the Akteur's HTTP surface, [`live`] the logic of its live channel, [`link`] what the edge tells it about the
//! caller. The Durable Object (wasm only) and the in-process Akteure of the tests are the two implementations of [`Akteure`].
use flyermap_host::http::{request::Request, response::Response};

pub mod channel;
pub mod conns;
pub mod link;
pub mod live;
pub mod serve;

pub use link::Link;
pub use live::Kick;

/// How the edge reaches an Akteur. A request carries the caller as `link::HEADER`; the answer is [`serve`]'s.
#[allow(async_fn_in_trait)] // single-threaded hosts (the Worker, the tests): no Send bound wanted
pub trait Akteure {
    /// The internal request (`POST /push`, `GET /snapshot`, …) to the Akteur of `aktion`. `Err` carries what went wrong, for the log only.
    async fn call(&self, aktion: &str, request: Request) -> Result<Response, String>;

    /// Close the live connections `kick` names, in the Akteur of `aktion`.
    async fn kick(&self, aktion: &str, kick: &Kick) -> Result<(), String>;
}

/// The server without Akteure (the directory only): every call fails. What `App::new` starts with.
pub struct NoAkteure;

impl Akteure for NoAkteure {
    async fn call(&self, _aktion: &str, _request: Request) -> Result<Response, String> {
        Err("no Akteure configured".into())
    }

    async fn kick(&self, _aktion: &str, _kick: &Kick) -> Result<(), String> {
        Ok(())
    }
}
