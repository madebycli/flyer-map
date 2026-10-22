//! The people of an Aktion and their grants; ending a grant; the audit log.
use super::Ctx;
use crate::directory::audit::Event;
use crate::{
    directory::{aktionen, audit, grants},
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{decide, may_grant, Action, Decision, OrgId, Resource, Role};
use serde_json::json;

/// `GET /v6/aktionen/:id/people`: everybody with a grant here, as far as the caller may manage them.
pub async fn list<D: Db>(c: &Ctx<'_, D>, aktion_id: &str) -> Done {
    let me = c.me()?;
    let aktion = aktionen::get(c.db, aktion_id).await?.ok_or_else(|| fail(Code::NotFound, "not found"))?;
    let now = c.now();
    let mut people = Vec::new();
    for m in grants::members_of_aktion(c.db, &aktion.org_id, &aktion.id, now).await? {
        let Some(g) = m.grant.grant() else { continue };
        if decide(&me.access, now, Action::ManagePeople, &Resource::of_scope(&g.scope)).is_allowed() {
            people.push(json!({
                "grant_id": m.grant.id, "person_id": m.grant.person_id, "display_name": m.display_name, "kind": m.kind,
                "role": g.role.as_str(), "scope": g.scope, "not_after": g.not_after, "created_at": m.grant.created_at,
            }));
        }
    }
    if people.is_empty() {
        // someone who may not manage anybody here learns nothing, not even that the Aktion exists
        c.allow(Action::ManagePeople, &Resource::aktion(&OrgId::new(&aktion.org_id), &flyermap_identity::AktionId::new(&aktion.id)))?;
    }
    Ok(Response::json(200, &json!({ "people": people })))
}

/// `DELETE /v6/grants/:id`: ends a grant. Allowed for whoever could hand that role out there, and for the holder (leaving). The last owner stays.
pub async fn revoke<D: Db>(c: &Ctx<'_, D>, id: &str) -> Done {
    let me = c.me()?;
    let row = grants::get(c.db, id).await?.filter(|r| r.revoked_at.is_none()).ok_or_else(|| fail(Code::NotFound, "not found"))?;
    let g = row.grant().ok_or_else(|| fail(Code::Internal, "grant unreadable"))?;
    let own = row.person_id == me.person.id;
    if !own {
        let managing = decide(&me.access, c.now(), Action::ManagePeople, &Resource::of_scope(&g.scope)).is_allowed();
        if !managing {
            return Err(fail(Code::NotFound, "not found"));
        }
        if may_grant(&me.access, c.now(), g.role, &g.scope) != Decision::Allow {
            return Err(fail(Code::Forbidden, "not allowed"));
        }
    }
    if g.role == Role::Owner && grants::count_live_owners(c.db, &row.org_id, c.now()).await? <= 1 {
        return Err(fail(Code::Conflict, "the last owner cannot be removed"));
    }
    grants::revoke(c.db, id, c.now()).await?;
    audit::record(
        c.db,
        c.now(),
        &Event {
            actor: Some(&me.person.id),
            org: Some(&row.org_id),
            aktion: row.aktion_id.as_deref(),
            action: "grant.revoke",
            target: Some(id),
            detail: Some(&row.role),
        },
    )
    .await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}

/// `GET /v6/audit?org=<id>&before=<seq>`: the log of an Organisation, for owners. `GET /v6/audit?mine=1`: what the caller did with their own account.
pub async fn audit_log<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let before = c.request.query("before").and_then(|b| b.parse().ok());
    if c.request.query("mine").is_some() {
        let entries = audit::list_by_actor(c.db, &me.person.id, before, 100).await?;
        return Ok(Response::json(200, &json!({ "entries": entries })));
    }
    let org = c.request.query("org").ok_or_else(|| fail(Code::InvalidRequest, "org missing"))?;
    c.allow(Action::ManageSecurity, &Resource::organisation(&OrgId::new(&org)))?;
    let entries = audit::list(c.db, &org, before, 100).await?;
    Ok(Response::json(200, &json!({ "entries": entries })))
}
