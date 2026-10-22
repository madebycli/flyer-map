//! Creating an Organisation with its first owner, and the person's own account: `/v6/organisations`, `/v6/me`.
use super::{opt_text, text, Ctx};
use crate::directory::audit::Event;
use crate::{
    auth::{brake, caller::access_of, session},
    directory::{
        aktionen, audit, credentials, grants,
        persons::{self, clean_handle, clean_name, Person},
    },
    error::{fail, Code, Done},
    kdf,
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{token::constant_time_eq, token::hash_token, Grant, OrgId, Role, Scope};
use serde_json::{json, Value};

pub const PASSWORD_MIN: usize = 10;
pub const PASSWORD_MAX: usize = 200;

pub fn check_password(password: &str) -> Done<()> {
    let n = password.chars().count();
    if (PASSWORD_MIN..=PASSWORD_MAX).contains(&n) {
        Ok(())
    } else {
        Err(fail(Code::InvalidRequest, format!("password needs {PASSWORD_MIN} to {PASSWORD_MAX} characters")))
    }
}

/// Everything the app shows about the person and what they may do. No secrets.
pub async fn me_json<D: Db>(c: &Ctx<'_, D>) -> Done<Value> {
    let me = c.me()?;
    let now = c.now();
    let rows = grants::live_rows(c.db, &me.person.id, now).await?;
    let grants: Vec<Value> =
        rows.iter().filter_map(|r| r.grant().map(|g| json!({ "id": r.id, "role": g.role.as_str(), "scope": g.scope, "not_after": g.not_after }))).collect();
    let passkeys: Vec<Value> = credentials::passkeys_of(c.db, &me.person.id)
        .await?
        .iter()
        .map(|p| json!({ "id": p.id, "label": p.label, "created_at": p.created_at, "last_used_at": p.last_used_at }))
        .collect();
    let totp = credentials::totp_of(c.db, &me.person.id).await?.is_some_and(|t| t.confirmed_at.is_some());
    Ok(json!({
        "person": { "id": me.person.id, "kind": me.person.kind, "handle": me.person.handle, "display_name": me.person.display_name },
        "session": { "id": me.session.id, "via": me.session.via },
        "grants": grants,
        "credentials": {
            "password": credentials::password_hash(c.db, &me.person.id).await?.is_some(),
            "passkeys": passkeys,
            "totp": totp,
            "recovery_codes_left": credentials::unused_recovery_codes(c.db, &me.person.id).await?,
        },
    }))
}

pub async fn me<D: Db>(c: &Ctx<'_, D>) -> Done {
    Ok(Response::json(200, &me_json(c).await?))
}

pub async fn update_me<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(2_000)?;
    let name = clean_name(&text(&body, "display_name", 60)?, "");
    if name.is_empty() {
        return Err(fail(Code::InvalidRequest, "display_name empty"));
    }
    persons::rename(c.db, &me.person.id, &name).await?;
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "person.rename", target: Some(&me.person.id), detail: None },
    )
    .await?;
    Ok(Response::json(200, &json!({ "display_name": name })))
}

/// `POST /v6/me/password`: change the password (the current one is required); all other devices are signed out.
pub async fn change_password<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(2_000)?;
    let (current, new) = (text(&body, "current", PASSWORD_MAX)?, text(&body, "new", PASSWORD_MAX)?);
    check_password(&new)?;
    let keys = [brake::key("password-change", &me.person.id)];
    brake::check(c.db, c.env, &keys).await?;
    let stored = credentials::password_hash(c.db, &me.person.id).await?;
    let ok = match stored {
        Some(hash) => kdf::verify_password(c.env.kdf.as_ref(), &c.env.config, &current, &hash).await,
        None => false,
    };
    if !ok {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(fail(Code::InvalidCredentials, "current password wrong"));
    }
    brake::succeeded(c.db, &keys).await?;
    let hash = kdf::hash_password(c.env.kdf.as_ref(), &c.env.config, &new, &c.env.bytes::<16>()).await;
    credentials::set_password(c.db, &me.person.id, &hash, c.now()).await?;
    let others = flyermap_server_sessions_revoke(c, &me.person.id, &me.session.id).await?;
    audit::record(
        c.db,
        c.now(),
        &Event {
            actor: Some(&me.person.id),
            org: None,
            aktion: None,
            action: "password.change",
            target: Some(&me.person.id),
            detail: Some(&format!("signed out {others} devices")),
        },
    )
    .await?;
    Ok(Response::json(200, &json!({ "signed_out_devices": others })))
}

async fn flyermap_server_sessions_revoke<D: Db>(c: &Ctx<'_, D>, person_id: &str, keep: &str) -> Done<u64> {
    Ok(crate::directory::sessions::revoke_others(c.db, person_id, keep, c.now()).await?)
}

/// `POST /v6/organisations`: the first owner creates their Organisation. Open sign-up, or the owner's setup key in `x-setup-key`.
pub async fn create_organisation<D: Db>(c: &Ctx<'_, D>) -> Done {
    let keys = [brake::address_key(c.request, "signup")];
    brake::check(c.db, c.env, &keys).await?;
    let setup_ok = match (&c.env.config.setup_key_sha256, c.request.header("x-setup-key")) {
        (Some(want), Some(given)) => constant_time_eq(want.as_bytes(), hash_token(given).as_bytes()),
        _ => false,
    };
    if !c.env.config.open_signup && !setup_ok {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(fail(Code::SignupClosed, "organisations are created with the setup key"));
    }
    let body = c.body(5_000)?;
    let name = text(&body, "name", 80)?;
    let owner = body.get("owner").and_then(Value::as_object).ok_or_else(|| fail(Code::InvalidRequest, "owner missing"))?;
    let handle = clean_handle(&text(owner, "handle", 80)?).ok_or_else(|| fail(Code::InvalidRequest, "handle: 3 to 40 letters, digits, . _ - @ +"))?;
    let display = clean_name(&opt_text(owner, "display_name", 60)?.unwrap_or_default(), &handle);
    let password = text(owner, "password", PASSWORD_MAX)?;
    check_password(&password)?;

    let now = c.now();
    let (org_id, person_id) = (c.env.id("o"), c.env.id("p"));
    let person = Person { id: person_id.clone(), kind: "person".into(), handle: Some(handle), display_name: display, created_at: now, disabled_at: None };
    let hash = kdf::hash_password(c.env.kdf.as_ref(), &c.env.config, &password, &c.env.bytes::<16>()).await;
    let grant = Grant::new(Role::Owner, Scope::Organisation { org: OrgId::new(&org_id) });
    let batch = [
        aktionen::insert_organisation_stmt(&org_id, &name, now),
        persons::insert_stmt(&person),
        credentials::set_password_stmt(&person_id, &hash, now),
        grants::insert_stmt(&c.env.id("g"), &person_id, &grant, None, None, now),
        audit::record_stmt(
            now,
            &Event { actor: Some(&person_id), org: Some(&org_id), aktion: None, action: "organisation.create", target: Some(&org_id), detail: None },
        ),
    ];
    if let Err(e) = c.db.batch(&batch).await {
        return Err(if persons::is_unique_violation(&e) { fail(Code::Conflict, "handle taken") } else { e.into() });
    }
    brake::succeeded(c.db, &keys).await?;
    let opened = session::open(c.db, c.env, &person_id, "setup", "Gerät").await?;
    let access = access_of(c.db, &person_id, now).await?;
    let caller = crate::auth::Caller { person, session: opened.session, access };
    let inner = Ctx { db: c.db, env: c.env, request: c.request, caller: Some(caller) };
    let mut response = Response::json(201, &json!({ "organisation": { "id": org_id, "name": name }, "me": me_json(&inner).await? }));
    response.set_header("set-cookie", &opened.set_cookie);
    Ok(response)
}
