//! The outer layer (`worker/indexOrganizer.ts`): the runtime contract, the field API, organisation accounts and security, the guards in front of
//! the campaign API, and what is added to its answers afterwards. Then the base layer ([`crate::base`]).
//!
//! Being ported (Plan 059 M7): until a route is here, the TypeScript Worker answers it (it stays in front and hands over only what is ported).
use crate::{db::Db, http::request::Request, http::response::Response, App};

pub async fn handle<D: Db>(app: &App<D>, request: &Request) -> Option<Response> {
    let mut response = match app.handle_v5(request).await {
        Some(response) => Some(response),
        None => crate::base::handle(app, request).await,
    };
    // Which Worker answered, while both run side by side (diagnostics; the TypeScript Worker hands route groups over).
    if let Some(r) = response.as_mut() {
        r.set_header("x-served-by", "flyermap-rs");
    }
    response
}
