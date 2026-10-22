//! The list of devices a person is signed in on, and signing one out.
use super::Ctx;
use crate::directory::audit::Event;
use crate::{
    directory::{audit, sessions},
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use serde_json::json;

pub async fn list<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let devices: Vec<_> = sessions::of_person(c.db, &me.person.id, c.now())
        .await?
        .into_iter()
        .map(|s| json!({ "id": s.id, "label": s.label, "via": s.via, "created_at": s.created_at, "last_seen_at": s.last_seen_at, "current": s.id == me.session.id }))
        .collect();
    Ok(Response::json(200, &json!({ "devices": devices })))
}

/// Signs one of the person's own devices out (also the current one).
pub async fn revoke<D: Db>(c: &Ctx<'_, D>, id: &str) -> Done {
    let me = c.me()?;
    if !sessions::revoke(c.db, &me.person.id, id, c.now()).await? {
        return Err(fail(Code::NotFound, "device not found"));
    }
    audit::record(c.db, c.now(), &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "session.revoke", target: Some(id), detail: None })
        .await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}
