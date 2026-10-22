//! Passkeys through the whole server, with a software authenticator.
mod support;
use ciborium::value::Value;
use flyermap_identity::b64;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde_json::json;
use sha2::{Digest, Sha256};
use support::*;

const CRED: &[u8] = b"credential-1";

fn cbor(v: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    ciborium::into_writer(v, &mut out).unwrap();
    out
}

fn head(flags: u8, count: u32) -> Vec<u8> {
    let mut d = Sha256::digest(b"app.test").to_vec();
    d.push(flags);
    d.extend_from_slice(&count.to_be_bytes());
    d
}

fn client_data(kind: &str, challenge: &str, origin: &str) -> Vec<u8> {
    format!(r#"{{"type":"{kind}","challenge":"{challenge}","origin":"{origin}"}}"#).into_bytes()
}

fn attestation(key: &SigningKey) -> Vec<u8> {
    let point = key.verifying_key().to_encoded_point(false);
    let cose = Value::Map(vec![
        (Value::Integer(1.into()), Value::Integer(2.into())),
        (Value::Integer(3.into()), Value::Integer((-7).into())),
        (Value::Integer((-1).into()), Value::Integer(1.into())),
        (Value::Integer((-2).into()), Value::Bytes(point.x().unwrap().to_vec())),
        (Value::Integer((-3).into()), Value::Bytes(point.y().unwrap().to_vec())),
    ]);
    let mut auth = head(0x45, 0);
    auth.extend_from_slice(&[0; 16]);
    auth.extend_from_slice(&(CRED.len() as u16).to_be_bytes());
    auth.extend_from_slice(CRED);
    auth.extend_from_slice(&cbor(&cose));
    cbor(&Value::Map(vec![
        (Value::Text("fmt".into()), Value::Text("none".into())),
        (Value::Text("attStmt".into()), Value::Map(vec![])),
        (Value::Text("authData".into()), Value::Bytes(auth)),
    ]))
}

fn register(w: &World, cookie: &str, key: &SigningKey, origin: &str) -> Reply {
    let opts = w.post("/v6/passkeys/register-options", json!({}), Some(cookie));
    assert_eq!(opts.status, 200, "{:?}", opts.json);
    assert_eq!(opts.json["options"]["rp"]["id"], "app.test");
    assert_eq!(opts.json["options"]["attestation"], "none");
    let challenge = opts.json["options"]["challenge"].as_str().unwrap();
    w.post(
        "/v6/passkeys/register",
        json!({
            "challenge_id": opts.json["challenge_id"],
            "label": "Pixel",
            "client_data_json": b64::encode(&client_data("webauthn.create", challenge, origin)),
            "attestation_object": b64::encode(&attestation(key)),
        }),
        Some(cookie),
    )
}

fn assertion(w: &World, key: &SigningKey, count: u32, tweak: impl Fn(&mut Vec<u8>)) -> (Reply, String, String) {
    let opts = w.post("/v6/session/passkey-options", json!({}), None);
    assert_eq!(opts.status, 200);
    let challenge = opts.json["options"]["challenge"].as_str().unwrap().to_string();
    let (client, mut auth) = (client_data("webauthn.get", &challenge, ORIGIN), head(0x05, count));
    let signature: Signature = {
        let mut signed = auth.clone();
        signed.extend_from_slice(&Sha256::digest(&client));
        key.sign(&signed)
    };
    tweak(&mut auth);
    let body = json!({
        "challenge_id": opts.json["challenge_id"], "credential_id": b64::encode(CRED), "label": "Pixel",
        "client_data_json": b64::encode(&client), "authenticator_data": b64::encode(&auth), "signature": b64::encode(signature.to_der().as_bytes()),
    });
    (w.post("/v6/session/passkey", body.clone(), None), opts.json["challenge_id"].as_str().unwrap().to_string(), body.to_string())
}

#[test]
fn a_passkey_is_added_and_signs_in_without_a_name() {
    let w = World::new();
    let (cookie, _) = w.organisation("anna");
    let key = SigningKey::random(&mut rand_core::OsRng);
    let added = register(&w, &cookie, &key, ORIGIN);
    assert_eq!(added.status, 201, "{:?}", added.json);
    assert_eq!(w.get("/v6/me", &cookie).json["credentials"]["passkeys"][0]["label"], "Pixel");
    assert_eq!(register(&w, &cookie, &key, ORIGIN).code(), "conflict", "the same passkey twice");

    let (signed, _, body) = assertion(&w, &key, 1, |_| {});
    assert_eq!(signed.status, 200, "{:?}", signed.json);
    assert_eq!(signed.json["me"]["session"]["via"], "passkey");
    assert_eq!(signed.json["me"]["person"]["handle"], "anna");
    // the same answer replayed: the challenge is gone
    let replay: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(w.post("/v6/session/passkey", replay, None).code(), "invalid_credentials");
    // a counter that does not go forward
    assert_eq!(assertion(&w, &key, 1, |_| {}).0.code(), "invalid_credentials");
    assert_eq!(assertion(&w, &key, 5, |_| {}).0.status, 200);
}

#[test]
fn a_passkey_from_the_wrong_place_or_key_is_refused() {
    let w = World::new();
    let (cookie, _) = w.organisation("anna");
    let key = SigningKey::random(&mut rand_core::OsRng);
    assert_eq!(register(&w, &cookie, &key, "https://evil.test").code(), "invalid_credentials", "registered on another origin");
    assert_eq!(register(&w, &cookie, &key, ORIGIN).status, 201);
    let other = SigningKey::random(&mut rand_core::OsRng);
    assert_eq!(assertion(&w, &other, 1, |_| {}).0.code(), "invalid_credentials", "another key");
    assert_eq!(assertion(&w, &key, 1, |a| a[36] ^= 1).0.code(), "invalid_credentials", "data changed after signing");
    // a challenge made for sign-in cannot register, and the other way round
    let opts = w.post("/v6/session/passkey-options", json!({}), None);
    let r = w.post(
        "/v6/passkeys/register",
        json!({ "challenge_id": opts.json["challenge_id"], "client_data_json": b64::encode(&client_data("webauthn.create", opts.json["options"]["challenge"].as_str().unwrap(), ORIGIN)), "attestation_object": b64::encode(&attestation(&other)) }),
        Some(&cookie),
    );
    assert_eq!(r.code(), "invalid_credentials");
    // nobody but the signed-in person registers a passkey for them
    assert_eq!(w.post("/v6/passkeys/register-options", json!({}), None).code(), "unauthorized");
}

#[test]
fn the_last_way_in_is_kept() {
    let w = World::new();
    let (cookie, _) = w.organisation("anna");
    let key = SigningKey::random(&mut rand_core::OsRng);
    register(&w, &cookie, &key, ORIGIN);
    let id = w.get("/v6/me", &cookie).json["credentials"]["passkeys"][0]["id"].as_str().unwrap().to_string();
    // with a password the passkey can go
    assert_eq!(w.call("DELETE", &format!("/v6/passkeys/{id}"), None, Some(&cookie)).status, 200);
    assert_eq!(w.call("DELETE", &format!("/v6/passkeys/{id}"), None, Some(&cookie)).code(), "not_found");
    assert_eq!(assertion(&w, &key, 1, |_| {}).0.code(), "invalid_credentials", "a removed passkey signs nobody in");
}
