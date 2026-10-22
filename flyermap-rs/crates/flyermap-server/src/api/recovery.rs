//! Recovery codes: making new ones, and signing in with one when every device and passkey is gone.
use super::{opt_text, second_factor::new_recovery_codes, text, Ctx};
use crate::directory::audit::Event;
use crate::{
    auth::brake,
    directory::{audit, credentials, persons},
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::recovery;
use serde_json::json;

/// `POST /v6/recovery-codes`: replaces the codes. Shown once.
pub async fn generate<D: Db>(c: &Ctx<'_, D>) -> Done {
    Ok(Response::json(200, &json!({ "recovery_codes": new_recovery_codes(c).await? })))
}

/// `POST /v6/session/recovery` `{handle, code, label?}`: signs in with one recovery code (used up). The app then asks for a new way to sign in.
pub async fn sign_in<D: Db>(c: &Ctx<'_, D>) -> Done {
    let body = c.body(1_000)?;
    let handle = persons::clean_handle(&text(&body, "handle", 80)?).ok_or_else(|| fail(Code::InvalidCredentials, "sign-in failed"))?;
    let keys = [brake::address_key(c.request, "recovery"), brake::key("handle", &handle)];
    brake::check(c.db, c.env, &keys).await?;
    let person = persons::by_handle(c.db, &handle).await?.filter(|p| p.disabled_at.is_none());
    let normalized = recovery::normalize(&text(&body, "code", 30)?);
    let used = match (&person, &normalized) {
        (Some(p), Some(code)) => credentials::use_recovery_code(c.db, &p.id, &recovery::hash_code(code), c.now()).await?,
        _ => false,
    };
    let Some(person) = person.filter(|_| used) else {
        brake::failed(c.db, c.env, &keys).await?;
        return Err(fail(Code::InvalidCredentials, "sign-in failed"));
    };
    brake::succeeded(c.db, &keys).await?;
    audit::record(c.db, c.now(), &Event { actor: Some(&person.id), org: None, aktion: None, action: "recovery.use", target: Some(&person.id), detail: None })
        .await?;
    let label = opt_text(&body, "label", 60)?.unwrap_or_default();
    super::sign_in::signed_in(c, person, "recovery", &label, 200).await
}
