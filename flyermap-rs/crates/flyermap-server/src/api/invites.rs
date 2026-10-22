//! Invitations: handing them out, listing and withdrawing them, and redeeming one (the way guests and new members come in).
use super::{opt_int, opt_text, Ctx};
use crate::directory::audit::Event;
use crate::{
    auth::{brake, caller::access_of, session, Caller},
    directory::{
        aktionen, audit, grants,
        invites::{self, InviteRow},
        persons::{self, clean_name, Person},
    },
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{invite, may_grant, Action, Decision, Denial, Resource, Role, Scope};
use serde_json::{json, Value};

fn public(row: &InviteRow) -> Value {
    json!({
        "id": row.id, "role": row.role, "scope": row.invite().map(|i| i.scope), "label": row.label, "max_uses": row.max_uses, "uses": row.uses,
        "not_after": row.not_after, "grant_ttl_ms": row.grant_ttl_ms, "created_by": row.created_by, "created_at": row.created_at, "revoked_at": row.revoked_at,
    })
}

fn refusal(d: Denial) -> crate::error::Failure {
    match d {
        Denial::RoleScopeMismatch => fail(Code::InvalidRequest, "this role does not fit that place"),
        Denial::OutOfScope | Denial::NoGrant | Denial::Expired => fail(Code::NotFound, "not found"),
        Denial::WrongArt | Denial::MissingCapability | Denial::CannotHandOut => fail(Code::Forbidden, "not allowed"),
    }
}

/// `POST /v6/invites` `{role, scope, label?, max_uses?, valid_hours?, grant_hours?}`. The code is in the answer, once.
pub async fn create<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(5_000)?;
    let role = body.get("role").and_then(Value::as_str).and_then(Role::parse).ok_or_else(|| fail(Code::InvalidRequest, "role unknown"))?;
    let scope: Scope = serde_json::from_value(body.get("scope").cloned().unwrap_or(Value::Null)).map_err(|_| fail(Code::InvalidRequest, "scope malformed"))?;
    if let Decision::Deny(d) = may_grant(&me.access, c.now(), role, &scope) {
        return Err(refusal(d));
    }
    if let Some(aktion) = scope.aktion() {
        if aktionen::get(c.db, &aktion.0).await?.is_none_or(|a| a.org_id != scope.org().0) {
            return Err(fail(Code::NotFound, "aktion not found"));
        }
    }
    let now = c.now();
    let max_uses = opt_int(&body, "max_uses", 1, 100_000)?.map_or(1, |n| n as u32);
    let valid_ms = opt_int(&body, "valid_hours", 1, 24 * 365)?.unwrap_or(72) * 3_600_000;
    let code = invite::new_code(&c.env.bytes::<{ invite::CODE_LEN }>());
    let columns = scope.columns();
    let row = InviteRow {
        id: c.env.id("i"),
        code_hash: invite::hash_code(&code),
        role: role.as_str().into(),
        scope_kind: columns.kind.into(),
        org_id: columns.org,
        aktion_id: columns.aktion,
        gruppe_id: columns.gruppe,
        gebiet_id: columns.gebiet,
        max_uses: Some(max_uses),
        uses: 0,
        not_after: Some(now + valid_ms),
        grant_ttl_ms: opt_int(&body, "grant_hours", 1, 24 * 365)?.map(|h| h * 3_600_000),
        label: clean_name(&opt_text(&body, "label", 60)?.unwrap_or_default(), "Einladung"),
        created_by: me.person.id.clone(),
        created_at: now,
        revoked_at: None,
    };
    invites::insert(c.db, &row).await?;
    audit::record(
        c.db,
        now,
        &Event {
            actor: Some(&me.person.id),
            org: Some(&row.org_id),
            aktion: row.aktion_id.as_deref(),
            action: "invite.create",
            target: Some(&row.id),
            detail: Some(&row.role),
        },
    )
    .await?;
    Ok(Response::json(201, &json!({ "invite": public(&row), "code": invite::display(&code), "link": format!("/beitreten/{code}") })))
}

/// `GET /v6/invites?aktion=<id>`: the invitations the caller may manage.
pub async fn list<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let id = c.request.query("aktion").ok_or_else(|| fail(Code::InvalidRequest, "aktion missing"))?;
    let aktion = aktionen::get(c.db, &id).await?.ok_or_else(|| fail(Code::NotFound, "aktion not found"))?;
    let mut out = Vec::new();
    for row in invites::of_aktion(c.db, &aktion.org_id, &aktion.id).await? {
        if let Some(scope) = row.invite().map(|i| i.scope) {
            if flyermap_identity::decide(&me.access, c.now(), Action::ManagePeople, &Resource::of_scope(&scope)).is_allowed() {
                out.push(public(&row));
            }
        }
    }
    Ok(Response::json(200, &json!({ "invites": out })))
}

/// `DELETE /v6/invites/:id`: withdraws an invitation (people who redeemed it keep what they got; revoke their grants to end that).
pub async fn revoke<D: Db>(c: &Ctx<'_, D>, id: &str) -> Done {
    let me = c.me()?;
    let row = invites::get(c.db, id).await?.ok_or_else(|| fail(Code::NotFound, "not found"))?;
    let scope = row.invite().map(|i| i.scope).ok_or_else(|| fail(Code::Internal, "invitation unreadable"))?;
    c.allow(Action::ManagePeople, &Resource::of_scope(&scope))?;
    invites::revoke(c.db, id, c.now()).await?;
    audit::record(
        c.db,
        c.now(),
        &Event {
            actor: Some(&me.person.id),
            org: Some(&row.org_id),
            aktion: row.aktion_id.as_deref(),
            action: "invite.revoke",
            target: Some(id),
            detail: None,
        },
    )
    .await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}

/// `POST /v6/invites/redeem` `{code, label?, display_name?}`: no sign-in needed. A device without account becomes a guest; a signed-in person
/// gets the grant added. Invitations for owners and admins need a signed-in person (an account), never a guest.
pub async fn redeem<D: Db>(c: &Ctx<'_, D>) -> Done {
    let keys = [brake::address_key(c.request, "redeem")];
    brake::check(c.db, c.env, &keys).await?;
    let body = c.body(2_000)?;
    let typed = super::text(&body, "code", 40)?;
    let invalid = || fail(Code::InviteInvalid, "invitation not valid");
    let Some(code) = invite::normalize(&typed) else {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(invalid());
    };
    let Some(row) = invites::by_code_hash(c.db, &invite::hash_code(&code)).await? else {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(invalid());
    };
    let now = c.now();
    let invitation = row.invite().ok_or_else(invalid)?;
    invitation.check(now).map_err(|_| invalid())?;
    let existing = c.caller.as_ref();
    if matches!(invitation.role, Role::Owner | Role::Admin) && existing.is_none_or(|e| e.person.kind != "person") {
        return Err(fail(Code::Unauthorized, "sign in with your account to accept this invitation"));
    }
    if !invites::take_place(c.db, &row.id, now).await? {
        return Err(invalid());
    }
    // a signed-in device keeps its person and session; a device without account becomes a guest with a new session
    let (person, session, set_cookie) = match existing {
        Some(e) => (e.person.clone(), e.session.clone(), None),
        None => {
            let name = clean_name(&opt_text(&body, "display_name", 60)?.unwrap_or_default(), "Gast");
            let guest = Person { id: c.env.id("p"), kind: "guest".into(), handle: None, display_name: name, created_at: now, disabled_at: None };
            persons::insert(c.db, &guest).await?;
            let label = opt_text(&body, "label", 60)?.unwrap_or_default();
            let opened = session::open(c.db, c.env, &guest.id, "invite", &label).await?;
            (guest, opened.session, Some(opened.set_cookie))
        }
    };
    let grant = invitation.grant_for(now);
    let grant_id = c.env.id("g");
    c.db.batch(&[
        grants::insert_stmt(&grant_id, &person.id, &grant, Some(&row.created_by), Some(&row.id), now),
        audit::record_stmt(
            now,
            &Event {
                actor: Some(&person.id),
                org: Some(&row.org_id),
                aktion: row.aktion_id.as_deref(),
                action: "invite.redeem",
                target: Some(&row.id),
                detail: Some(&row.role),
            },
        ),
    ])
    .await?;
    brake::succeeded(c.db, &keys).await?;
    let aktion = match row.aktion_id.as_deref() {
        Some(id) => aktionen::get(c.db, id).await?.map(|a| json!({ "id": a.id, "name": a.name })),
        None => None,
    };
    let caller = Caller { access: access_of(c.db, &person.id, now).await?, person, session };
    let inner = Ctx { db: c.db, env: c.env, request: c.request, caller: Some(caller) };
    let mut response = Response::json(200, &json!({ "me": super::accounts::me_json(&inner).await?, "aktion": aktion, "grant_id": grant_id }));
    if let Some(cookie) = set_cookie {
        response.set_header("set-cookie", &cookie);
    }
    Ok(response)
}
