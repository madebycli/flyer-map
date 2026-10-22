//! The optional second factor (TOTP) and the recovery codes that stand behind it.
use super::{text, Ctx};
use crate::directory::audit::Event;
use crate::{
    directory::{audit, credentials},
    error::{fail, Code, Done},
    seal,
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::{recovery, totp};
use serde_json::json;

fn seal_key<D: Db>(c: &Ctx<'_, D>) -> Done<[u8; 32]> {
    c.env.config.seal_key.as_deref().and_then(seal::key_from).ok_or_else(|| fail(Code::Internal, "seal key missing"))
}

/// `POST /v6/totp/enroll`: a new secret for the authenticator app. It counts only after `confirm`.
pub async fn enroll<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let secret: [u8; 20] = c.env.bytes::<20>();
    let sealed = seal::seal(&seal_key(c)?, &c.env.bytes::<12>(), &secret);
    if !credentials::start_totp(c.db, &me.person.id, &sealed).await? {
        return Err(fail(Code::Conflict, "a second factor is active already"));
    }
    let account = me.person.handle.clone().unwrap_or_else(|| me.person.display_name.clone());
    Ok(Response::json(200, &json!({ "secret": totp::base32_encode(&secret), "uri": totp::otpauth_uri("Flyer Map", &account, &secret) })))
}

/// `POST /v6/totp/confirm` `{code}`: proves the app works. The first time, recovery codes come with it (shown once).
pub async fn confirm<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let code = text(&c.body(500)?, "code", 12)?;
    let row =
        credentials::totp_of(c.db, &me.person.id).await?.filter(|t| t.confirmed_at.is_none()).ok_or_else(|| fail(Code::Conflict, "nothing to confirm"))?;
    let secret = seal::open(&seal_key(c)?, &row.secret_sealed).ok_or_else(|| fail(Code::Internal, "secret unreadable"))?;
    let step = totp::verify(&secret, c.now(), &code, None).ok_or_else(|| fail(Code::InvalidCredentials, "code wrong"))?;
    credentials::confirm_totp(c.db, &me.person.id, step, c.now()).await?;
    let codes = if credentials::unused_recovery_codes(c.db, &me.person.id).await? == 0 { Some(new_recovery_codes(c).await?) } else { None };
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "totp.enable", target: Some(&me.person.id), detail: None },
    )
    .await?;
    Ok(Response::json(200, &json!({ "ok": true, "recovery_codes": codes })))
}

/// `DELETE /v6/totp` `{code}`: switching the factor off needs a valid code (or a recovery code).
pub async fn remove<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(500)?;
    let code = text(&body, "code", 30)?;
    let (as_totp, as_recovery) =
        if code.chars().filter(|ch| !ch.is_whitespace()).count() <= 8 { (Some(code.as_str()), None) } else { (None, Some(code.as_str())) };
    if !super::sign_in::check_second_factor(c, &me.person.id, as_totp, as_recovery).await? {
        return Err(fail(Code::InvalidCredentials, "code wrong"));
    }
    credentials::remove_totp(c.db, &me.person.id).await?;
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "totp.disable", target: Some(&me.person.id), detail: None },
    )
    .await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}

/// Eight new codes; the old ones stop working. Returned once.
pub async fn new_recovery_codes<D: Db>(c: &Ctx<'_, D>) -> Done<Vec<String>> {
    let me = c.me()?;
    let codes = recovery::new_codes(&c.env.bytes::<{ recovery::COUNT * recovery::CODE_LEN }>());
    let hashes: Vec<String> = codes.iter().map(|code| recovery::hash_code(code)).collect();
    credentials::replace_recovery_codes(c.db, &me.person.id, &hashes).await?;
    audit::record(
        c.db,
        c.now(),
        &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "recovery.generate", target: Some(&me.person.id), detail: None },
    )
    .await?;
    Ok(codes.iter().map(|code| recovery::display(code)).collect())
}
