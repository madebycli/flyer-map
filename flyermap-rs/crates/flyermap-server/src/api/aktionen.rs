//! Aktionen: creating them, and listing those a person can enter.
use super::{text, Ctx};
use crate::directory::audit::Event;
use crate::{
    directory::{
        aktionen::{self, AktionRow},
        audit,
    },
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{may_enter, Action, AktionId, OrgId, Resource};
use serde_json::json;

/// `POST /v6/aktionen` `{org_id, name}`: needs the right to manage the Aktion level of the Organisation (owner, admin).
pub async fn create<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(2_000)?;
    let (org_id, name) = (text(&body, "org_id", 80)?, text(&body, "name", 80)?);
    c.allow(Action::ManageAktion, &Resource::organisation(&OrgId::new(&org_id)))?;
    let row = AktionRow { id: c.env.id("a"), org_id: org_id.clone(), name, created_by: me.person.id.clone(), created_at: c.now(), archived_at: None };
    if aktionen::organisation_name(c.db, &org_id).await?.is_none() {
        return Err(fail(Code::NotFound, "organisation not found"));
    }
    aktionen::insert(c.db, &row).await?;
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&me.person.id), org: Some(&org_id), aktion: Some(&row.id), action: "aktion.create", target: Some(&row.id), detail: None },
    )
    .await?;
    Ok(Response::json(201, &json!({ "aktion": row })))
}

/// `GET /v6/aktionen`: the Aktionen the caller may enter (through any grant), newest last.
pub async fn list<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let mut orgs: Vec<String> = Vec::new();
    for g in me.access.active(c.now()) {
        let org = g.scope.org().0.clone();
        if !orgs.contains(&org) {
            orgs.push(org);
        }
    }
    let mut out = Vec::new();
    for org in orgs {
        for a in aktionen::of_org(c.db, &org).await? {
            if may_enter(&me.access, c.now(), &OrgId::new(&a.org_id), &AktionId::new(&a.id)) {
                out.push(a);
            }
        }
    }
    Ok(Response::json(200, &json!({ "aktionen": out })))
}
