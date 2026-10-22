//! The outer layer (`worker/indexOrganizer.ts`): the runtime contract, the field API, organisation accounts and security, the guards in front of
//! the campaign API, and what is added to its answers afterwards. Then the base layer ([`crate::base`]).
//!
//! Being ported (Plan 059 M7): until a route is here, the TypeScript Worker answers it (it stays in front and hands over only what is ported).
use crate::{db::Db, http::request::Request, http::response::Response, App};

pub async fn handle<D: Db>(app: &App<D>, request: &Request) -> Option<Response> {
    if let Some(response) = app.handle_v5(request).await {
        return Some(response);
    }
    crate::base::handle(app, request).await
}
