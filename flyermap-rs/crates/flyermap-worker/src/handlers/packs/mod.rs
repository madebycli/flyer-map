//! Map packs of a Gebiet: `GET /areas/:a/pack` hands the stored pack out (the version is the ETag), `POST` builds it from the map data source.
//! A big Gebiet is stored in parts (`?part=N`, one request each); its own row only says "all parts are there".
mod build;
mod parts;
mod read;

pub use build::build;
pub use read::get;

use crate::{
    db::{Db, DbError},
    http::request::Request,
    repo,
};
use flyermap_rights::{can_read_area, AreaRef, Caller};

const CACHE_CONTROL: &str = "private, max-age=0, must-revalidate";

/// `?part=N`: `Ok(None)` when absent, `Err(())` when not 1–4 digits.
fn part_of(request: &Request) -> Result<Option<usize>, ()> {
    match request.query("part") {
        None => Ok(None),
        Some(raw) if (1..=4).contains(&raw.len()) && raw.bytes().all(|b| b.is_ascii_digit()) => raw.parse().map(Some).map_err(|_| ()),
        Some(_) => Err(()),
    }
}

/// The Gebiet when it exists and the caller may read it.
async fn readable<D: Db>(db: &D, caller: &Caller, campaign_id: &str, area_id: &str) -> Result<Option<AreaRef>, DbError> {
    Ok(repo::areas::resolve_area(db, campaign_id, area_id).await?.filter(|area| can_read_area(caller, area)))
}
