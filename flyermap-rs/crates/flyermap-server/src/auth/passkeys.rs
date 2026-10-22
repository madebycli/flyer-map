//! The two passkey ceremonies, as far as they are the server's business: handing out challenges, and checking what comes back.
use crate::{
    directory::{challenges, credentials, persons::Person},
    env::Env,
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::request::Request};
use flyermap_identity::{
    b64,
    passkey::{verify_assertion, verify_registration, Assertion, Expect, Passkey, Registration},
};

/// The origins a ceremony may run on: the configured ones, or (nothing configured) the origin of the request itself.
pub fn origins(env: &Env, request: &Request) -> Vec<String> {
    if env.config.origins.is_empty() {
        vec![request.origin()]
    } else {
        env.config.origins.clone()
    }
}

pub async fn new_challenge<D: Db>(db: &D, env: &Env, kind: &str, person: Option<&Person>) -> Done<(String, String)> {
    let (id, challenge) = (env.id("c"), b64::encode(&(env.random)()));
    challenges::put(db, &id, kind, person.map(|p| p.id.as_str()), &challenge, env.now()).await?;
    Ok((id, challenge))
}

fn problem(_: flyermap_identity::passkey::Problem) -> crate::error::Failure {
    fail(Code::InvalidCredentials, "passkey refused")
}

pub struct Registered {
    pub passkey: Passkey,
}

/// Checks a new passkey against the challenge that was handed out for this person.
pub async fn check_registration<D: Db>(
    db: &D,
    env: &Env,
    request: &Request,
    person: &Person,
    challenge_id: &str,
    client_data: &[u8],
    attestation: &[u8],
) -> Done<Registered> {
    let taken = challenges::take(db, challenge_id, "passkey-register", env.now()).await?.filter(|t| t.person_id.as_deref() == Some(person.id.as_str()));
    let challenge = taken.and_then(|t| b64::decode(&t.challenge)).ok_or_else(|| fail(Code::InvalidCredentials, "challenge unknown or used"))?;
    let origins = origins(env, request);
    let origin_refs: Vec<&str> = origins.iter().map(String::as_str).collect();
    let expect = Expect { rp_id: &env.config.rp_id, origins: &origin_refs, challenge: &challenge, require_user_verification: false };
    let passkey = verify_registration(&Registration { client_data_json: client_data, attestation_object: attestation }, &expect).map_err(problem)?;
    Ok(Registered { passkey })
}

pub struct SignedIn {
    pub person_id: String,
}

/// What the browser sent for a sign-in, decoded.
pub struct AssertionInput<'a> {
    pub challenge_id: &'a str,
    pub credential_id: &'a str,
    pub client_data: &'a [u8],
    pub auth_data: &'a [u8],
    pub signature: &'a [u8],
}

/// Checks a sign-in; updates the counter. The challenge is used up whatever the outcome.
pub async fn check_assertion<D: Db>(db: &D, env: &Env, request: &Request, input: &AssertionInput<'_>) -> Done<SignedIn> {
    let taken = challenges::take(db, input.challenge_id, "passkey-sign-in", env.now()).await?;
    let challenge = taken.and_then(|t| b64::decode(&t.challenge)).ok_or_else(|| fail(Code::InvalidCredentials, "challenge unknown or used"))?;
    let row = credentials::passkey_by_credential(db, input.credential_id).await?.ok_or_else(|| fail(Code::InvalidCredentials, "passkey unknown"))?;
    let key = Passkey {
        credential_id: b64::decode(&row.credential_id).unwrap_or_default(),
        public_key: b64::decode(&row.public_key).unwrap_or_default(),
        sign_count: row.sign_count,
    };
    let origins = origins(env, request);
    let origin_refs: Vec<&str> = origins.iter().map(String::as_str).collect();
    let expect = Expect { rp_id: &env.config.rp_id, origins: &origin_refs, challenge: &challenge, require_user_verification: false };
    let assertion = Assertion { client_data_json: input.client_data, authenticator_data: input.auth_data, signature: input.signature };
    let count = verify_assertion(&assertion, &key, &expect).map_err(problem)?;
    credentials::passkey_used(db, &row.id, count, env.now()).await?;
    Ok(SignedIn { person_id: row.person_id })
}
