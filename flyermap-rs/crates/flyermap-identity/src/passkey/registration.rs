//! Checking a new passkey: the browser's `attestationObject` and `clientDataJSON` from `navigator.credentials.create()`.
use super::{authdata, client, cose, Expect, Passkey, Problem};
use ciborium::value::Value;

/// What the browser sends back, decoded from base64url by the caller.
pub struct Registration<'a> {
    pub client_data_json: &'a [u8],
    pub attestation_object: &'a [u8],
}

pub fn verify_registration(reg: &Registration<'_>, expect: &Expect<'_>) -> Result<Passkey, Problem> {
    client::check(reg.client_data_json, "webauthn.create", expect)?;
    let object: Value = ciborium::from_reader(reg.attestation_object).map_err(|_| Problem::Malformed)?;
    let map = object.as_map().ok_or(Problem::Malformed)?;
    let field = |name: &str| map.iter().find(|(k, _)| k.as_text() == Some(name)).map(|(_, v)| v);
    if field("fmt").and_then(Value::as_text) != Some("none") {
        return Err(Problem::UnsupportedAttestation);
    }
    let auth_bytes = field("authData").and_then(Value::as_bytes).ok_or(Problem::Malformed)?;
    let auth = authdata::parse(auth_bytes)?;
    authdata::check(&auth, expect.rp_id, expect.require_user_verification)?;
    if auth.flags & authdata::FLAG_AT == 0 {
        return Err(Problem::Malformed);
    }
    // attested credential data: aaguid(16) ‖ id length(2) ‖ id ‖ COSE key (CBOR, may be followed by extensions)
    let rest = auth.rest;
    if rest.len() < 18 {
        return Err(Problem::Malformed);
    }
    let id_len = usize::from(u16::from_be_bytes([rest[16], rest[17]]));
    let id = rest.get(18..18 + id_len).filter(|id| !id.is_empty() && id.len() <= 1023).ok_or(Problem::Malformed)?;
    let mut key_bytes = &rest[18 + id_len..];
    let key: Value = ciborium::from_reader(&mut key_bytes).map_err(|_| Problem::Malformed)?;
    Ok(Passkey { credential_id: id.to_vec(), public_key: cose::es256_public_key(&key)?, sign_count: auth.sign_count })
}
