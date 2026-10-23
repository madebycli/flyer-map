//! The Cloudflare side of the Akteur (wasm only): the Durable Object that holds one Aktion ([`AktionObject`]), its storage ([`sql::DoSql`]) and the edge's
//! way to it ([`DoAkteure`]). Everything that decides something is in `crate::akteur`, tested natively; this is the carrying out.
mod convert;
mod object;
#[cfg(feature = "probe")]
mod probe;
mod sql;
mod stub;

pub(crate) use convert::{request_of, response_of};
pub use stub::DoAkteure;
