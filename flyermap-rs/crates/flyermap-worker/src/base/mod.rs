//! The base layer (`worker/indexFc52.ts` around `worker/index.ts`): health, access links and sessions, campaign admin accounts, collection
//! (Abholen) access and management, pick-up markers and search, snapshots and mutations.
//!
//! Being ported (Plan 059 M7): until a route is here, the TypeScript Worker answers it.
use crate::{db::Db, http::request::Request, http::response::Response, App};

pub async fn handle<D: Db>(_app: &App<D>, _request: &Request) -> Option<Response> {
    None
}
