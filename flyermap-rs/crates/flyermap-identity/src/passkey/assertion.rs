//! Checking a sign-in with a passkey: the browser's answer from `navigator.credentials.get()`.
use super::{authdata, client, Expect, Passkey, Problem};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use sha2::{Digest, Sha256};

pub struct Assertion<'a> {
    pub client_data_json: &'a [u8],
    pub authenticator_data: &'a [u8],
    /// DER-encoded ECDSA signature.
    pub signature: &'a [u8],
}

/// Returns the new counter to store. A counter that does not go forward is refused when either side counts at all (an authenticator that never
/// counts stays at zero, which is allowed).
pub fn verify_assertion(a: &Assertion<'_>, key: &Passkey, expect: &Expect<'_>) -> Result<u32, Problem> {
    client::check(a.client_data_json, "webauthn.get", expect)?;
    let auth = authdata::parse(a.authenticator_data)?;
    authdata::check(&auth, expect.rp_id, expect.require_user_verification)?;
    let mut signed = a.authenticator_data.to_vec();
    signed.extend_from_slice(&Sha256::digest(a.client_data_json));
    let verifying = VerifyingKey::from_sec1_bytes(&key.public_key).map_err(|_| Problem::UnsupportedKey)?;
    let signature = Signature::from_der(a.signature).map_err(|_| Problem::Malformed)?;
    verifying.verify(&signed, &signature).map_err(|_| Problem::BadSignature)?;
    if (auth.sign_count != 0 || key.sign_count != 0) && auth.sign_count <= key.sign_count {
        return Err(Problem::CounterWentBack);
    }
    Ok(auth.sign_count)
}
