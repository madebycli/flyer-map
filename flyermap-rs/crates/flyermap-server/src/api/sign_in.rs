//! Signing in with a password (and the second factor, if the person has one), and signing out.
use super::{accounts::me_json, opt_text, text, Ctx};
use crate::akteur::Kick;
use crate::directory::audit::Event;
use crate::{
    auth::{
        brake,
        caller::{access_of, clearing_cookie},
        session, Caller,
    },
    directory::{audit, credentials, persons},
    error::{fail, Code, Done},
    kdf, seal,
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{recovery, totp};

/// A response that signs the person in: the cookie and `me`.
pub async fn signed_in<D: Db>(c: &Ctx<'_, D>, person: persons::Person, via: &str, label: &str, status: u16) -> Done {
    let opened = session::open(c.db, c.env, &person.id, via, label).await?;
    let access = access_of(c.db, &person.id, c.now()).await?;
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&person.id), org: None, aktion: None, action: "session.open", target: Some(&opened.session.id), detail: Some(via) },
    )
    .await?;
    let inner = Ctx::new(c.db, c.env, c.request, Some(Caller { person, session: opened.session, access }));
    let mut response = Response::json(status, &serde_json::json!({ "me": me_json(&inner).await? }));
    response.set_header("set-cookie", &opened.set_cookie);
    Ok(response)
}

/// The second factor of a person who has one: a TOTP code (used once) or a recovery code.
pub async fn check_second_factor<D: Db>(c: &Ctx<'_, D>, person_id: &str, totp_code: Option<&str>, recovery_code: Option<&str>) -> Done<bool> {
    let Some(row) = credentials::totp_of(c.db, person_id).await?.filter(|t| t.confirmed_at.is_some()) else { return Ok(true) };
    let now = c.now();
    if let Some(code) = totp_code {
        let key = c.env.config.seal_key.as_deref().and_then(seal::key_from).ok_or_else(|| fail(Code::Internal, "seal key missing"))?;
        let secret = seal::open(&key, &row.secret_sealed).ok_or_else(|| fail(Code::Internal, "secret unreadable"))?;
        return match totp::verify(&secret, now, code, row.last_step) {
            Some(step) => Ok(credentials::use_totp_step(c.db, person_id, step).await?),
            None => Ok(false),
        };
    }
    if let Some(code) = recovery_code.and_then(recovery::normalize) {
        return Ok(credentials::use_recovery_code(c.db, person_id, &recovery::hash_code(&code), now).await?);
    }
    Ok(false)
}

/// `POST /v6/session/password` `{handle, password, totp?, recovery_code?, label?}`.
pub async fn password<D: Db>(c: &Ctx<'_, D>) -> Done {
    let body = c.body(2_000)?;
    let handle = persons::clean_handle(&text(&body, "handle", 80)?).ok_or_else(|| fail(Code::InvalidCredentials, "sign-in failed"))?;
    let password = text(&body, "password", super::accounts::PASSWORD_MAX)?;
    let keys = [brake::address_key(c.request, "sign-in"), brake::key("handle", &handle)];
    brake::check(c.db, c.env, &keys).await?;

    let person = persons::by_handle(c.db, &handle).await?.filter(|p| p.disabled_at.is_none());
    let stored = match &person {
        Some(p) => credentials::password_hash(c.db, &p.id).await?,
        None => None,
    };
    let verified = match &stored {
        Some(hash) => kdf::verify_password(c.env.kdf.as_ref(), &c.env.config, &password, hash).await,
        None => {
            kdf::waste_time(c.env.kdf.as_ref(), &c.env.config, &password).await;
            false
        }
    };
    let Some(person) = person.filter(|_| verified) else {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(fail(Code::InvalidCredentials, "sign-in failed"));
    };
    let (totp_code, recovery_code) = (opt_text(&body, "totp", 12)?, opt_text(&body, "recovery_code", 30)?);
    let has_factor = credentials::totp_of(c.db, &person.id).await?.is_some_and(|t| t.confirmed_at.is_some());
    if has_factor && totp_code.is_none() && recovery_code.is_none() {
        return Err(fail(Code::SecondFactorRequired, "enter the code of the authenticator app"));
    }
    if !check_second_factor(c, &person.id, totp_code.as_deref(), recovery_code.as_deref()).await? {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(fail(Code::InvalidCredentials, "sign-in failed"));
    }
    brake::succeeded(c.db, &keys).await?;
    let label = opt_text(&body, "label", 60)?.unwrap_or_default();
    signed_in(c, person, "password", &label, 200).await
}

/// `POST /v6/session/logout`: ends this device's session and clears the cookie.
pub async fn logout<D: Db>(c: &Ctx<'_, D>) -> Done {
    if let Some(me) = c.caller.as_ref() {
        crate::directory::sessions::revoke(c.db, &me.person.id, &me.session.id, c.now()).await?;
        audit::record(
            c.db,
            c.now(),
            &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "session.close", target: Some(&me.session.id), detail: None },
        )
        .await?;
        super::akteur::kick_session(c, &me.access, &Kick::session(&me.person.id, &me.session.id)).await?;
    }
    let mut response = Response::json(200, &serde_json::json!({ "ok": true }));
    response.set_header("set-cookie", &clearing_cookie());
    Ok(response)
}
