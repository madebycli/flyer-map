//! Passkeys: adding one to the account, signing in with one, removing one.
use super::{bytes, opt_text, text, Ctx};
use crate::directory::audit::Event;
use crate::{
    auth::{brake, passkeys as ceremony},
    directory::{
        audit, credentials,
        persons::{self, clean_name},
    },
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::response::Response};
use flyermap_identity::b64;
use serde_json::json;

/// `POST /v6/passkeys/register-options`: what the browser needs for `navigator.credentials.create()`.
pub async fn register_options<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let (id, challenge) = ceremony::new_challenge(c.db, c.env, "passkey-register", Some(&me.person)).await?;
    let existing: Vec<_> =
        credentials::passkeys_of(c.db, &me.person.id).await?.into_iter().map(|p| json!({ "type": "public-key", "id": p.credential_id })).collect();
    Ok(Response::json(
        200,
        &json!({
            "challenge_id": id,
            "options": {
                "rp": { "id": c.env.config.rp_id, "name": "Flyer Map" },
                "user": { "id": b64::encode(me.person.id.as_bytes()), "name": me.person.handle.clone().unwrap_or_else(|| me.person.display_name.clone()), "displayName": me.person.display_name },
                "challenge": challenge,
                "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
                "authenticatorSelection": { "residentKey": "preferred", "userVerification": "preferred" },
                "attestation": "none",
                "excludeCredentials": existing,
                "timeout": 120_000,
            },
        }),
    ))
}

/// `POST /v6/passkeys/register` `{challenge_id, label?, client_data_json, attestation_object}` (base64url).
pub async fn register<D: Db>(c: &Ctx<'_, D>) -> Done {
    let me = c.me()?;
    let body = c.body(20_000)?;
    let challenge_id = text(&body, "challenge_id", 80)?;
    let (client, attestation) = (bytes(&body, "client_data_json", 4_000)?, bytes(&body, "attestation_object", 8_000)?);
    let registered = ceremony::check_registration(c.db, c.env, c.request, &me.person, &challenge_id, &client, &attestation).await?;
    let row = credentials::PasskeyRow {
        id: c.env.id("k"),
        person_id: me.person.id.clone(),
        credential_id: b64::encode(&registered.passkey.credential_id),
        public_key: b64::encode(&registered.passkey.public_key),
        sign_count: registered.passkey.sign_count,
        label: clean_name(&opt_text(&body, "label", 60)?.unwrap_or_default(), "Passkey"),
        created_at: c.now(),
        last_used_at: None,
    };
    if !credentials::add_passkey(c.db, &row).await? {
        return Err(fail(Code::Conflict, "passkey already registered"));
    }
    audit::record(c.db, c.now(), &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "passkey.add", target: Some(&row.id), detail: None })
        .await?;
    Ok(Response::json(201, &json!({ "passkey": { "id": row.id, "label": row.label, "created_at": row.created_at } })))
}

/// `DELETE /v6/passkeys/:id`: not the last way in (a password or another passkey must stay).
pub async fn remove<D: Db>(c: &Ctx<'_, D>, id: &str) -> Done {
    let me = c.me()?;
    let passkeys = credentials::passkeys_of(c.db, &me.person.id).await?;
    if !passkeys.iter().any(|p| p.id == id) {
        return Err(fail(Code::NotFound, "passkey not found"));
    }
    if passkeys.len() == 1 && credentials::password_hash(c.db, &me.person.id).await?.is_none() {
        return Err(fail(Code::Conflict, "the last way to sign in cannot be removed"));
    }
    credentials::remove_passkey(c.db, &me.person.id, id).await?;
    audit::record(c.db, c.now(), &Event { actor: Some(&me.person.id), org: None, aktion: None, action: "passkey.remove", target: Some(id), detail: None })
        .await?;
    Ok(Response::json(200, &json!({ "ok": true })))
}

/// `POST /v6/session/passkey-options`: a challenge for signing in without typing a name.
pub async fn sign_in_options<D: Db>(c: &Ctx<'_, D>) -> Done {
    let keys = [brake::address_key(c.request, "passkey-options")];
    brake::check(c.db, c.env, &keys).await?;
    brake::failed(c.db, c.env, &keys).await?; // asking is cheap for us but not free: a generous limit of its own
    let (id, challenge) = ceremony::new_challenge(c.db, c.env, "passkey-sign-in", None).await?;
    Ok(Response::json(
        200,
        &json!({ "challenge_id": id, "options": { "challenge": challenge, "rpId": c.env.config.rp_id, "userVerification": "preferred", "timeout": 120_000 } }),
    ))
}

/// `POST /v6/session/passkey` `{challenge_id, credential_id, client_data_json, authenticator_data, signature, label?}`.
pub async fn sign_in<D: Db>(c: &Ctx<'_, D>) -> Done {
    let keys = [brake::address_key(c.request, "passkey")];
    brake::check(c.db, c.env, &keys).await?;
    let body = c.body(20_000)?;
    let challenge_id = text(&body, "challenge_id", 80)?;
    let credential_id = text(&body, "credential_id", 1_400)?;
    let (client, auth, signature) = (bytes(&body, "client_data_json", 4_000)?, bytes(&body, "authenticator_data", 2_000)?, bytes(&body, "signature", 200)?);
    let result = ceremony::check_assertion(
        c.db,
        c.env,
        c.request,
        &ceremony::AssertionInput { challenge_id: &challenge_id, credential_id: &credential_id, client_data: &client, auth_data: &auth, signature: &signature },
    )
    .await;
    let signed = match result {
        Ok(s) => s,
        Err(e) => {
            if e.code == Code::InvalidCredentials {
                brake::failed(c.db, c.env, &keys).await?;
            }
            return Err(e);
        }
    };
    let person =
        persons::get(c.db, &signed.person_id).await?.filter(|p| p.disabled_at.is_none()).ok_or_else(|| fail(Code::InvalidCredentials, "person unknown"))?;
    let label = opt_text(&body, "label", 60)?.unwrap_or_default();
    super::sign_in::signed_in(c, person, "passkey", &label, 200).await
}
