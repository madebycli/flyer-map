//! Who is asking: resolved from the request's cookies, never from its body. The chain is the TypeScript Worker's: a campaign session (link or
//! organiser), then an Abhol-Helfer session. Organiser accounts and organisation members join when the organiser API moves (Plan 059 M7).
pub mod collector;
pub mod cookies;
pub mod hash;
pub mod session;

use crate::{db::Db, http::request::Request};
use flyermap_rights::Caller;

pub async fn resolve<D: Db>(
    db: &D,
    request: &Request,
    campaign_id: &str,
    now_iso: &str,
) -> Result<Option<Caller>, crate::db::DbError> {
    if let Some(caller) =
        session::resolve_persistent(db, request, Some(campaign_id), now_iso, true).await?
    {
        return Ok(Some(caller));
    }
    collector::resolve(db, request, Some(campaign_id), now_iso).await
}
