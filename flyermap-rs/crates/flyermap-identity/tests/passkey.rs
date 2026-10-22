//! Passkeys against a software authenticator built in the test: a real P-256 key, real CBOR, real signatures; then every way to get it wrong.
use ciborium::value::Value;
use flyermap_identity::{
    b64,
    passkey::{verify_assertion, verify_registration, Assertion, Expect, Passkey, Problem, Registration},
};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use sha2::{Digest, Sha256};

const RP: &str = "flyer.example.org";
const ORIGIN: &str = "https://flyer.example.org";
const CHALLENGE: [u8; 32] = [9; 32];

fn expect<'a>(challenge: &'a [u8], origins: &'a [&'a str], uv: bool) -> Expect<'a> {
    Expect { rp_id: RP, origins, challenge, require_user_verification: uv }
}

fn client_data(kind: &str, challenge: &[u8], origin: &str) -> Vec<u8> {
    format!(r#"{{"type":"{kind}","challenge":"{}","origin":"{origin}","crossOrigin":false}}"#, b64::encode(challenge)).into_bytes()
}

fn head(rp: &str, flags: u8, count: u32) -> Vec<u8> {
    let mut d = Sha256::digest(rp.as_bytes()).to_vec();
    d.push(flags);
    d.extend_from_slice(&count.to_be_bytes());
    d
}

fn cbor(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    ciborium::into_writer(value, &mut out).unwrap();
    out
}

fn cose_key(key: &SigningKey, alg: i64) -> Value {
    let point = key.verifying_key().to_encoded_point(false);
    Value::Map(vec![
        (Value::Integer(1.into()), Value::Integer(2.into())),
        (Value::Integer(3.into()), Value::Integer(alg.into())),
        (Value::Integer((-1).into()), Value::Integer(1.into())),
        (Value::Integer((-2).into()), Value::Bytes(point.x().unwrap().to_vec())),
        (Value::Integer((-3).into()), Value::Bytes(point.y().unwrap().to_vec())),
    ])
}

fn attestation(key: &SigningKey, rp: &str, flags: u8, fmt: &str, alg: i64) -> Vec<u8> {
    let mut auth = head(rp, flags, 0);
    auth.extend_from_slice(&[0; 16]);
    auth.extend_from_slice(&4u16.to_be_bytes());
    auth.extend_from_slice(b"cred");
    auth.extend_from_slice(&cbor(&cose_key(key, alg)));
    cbor(&Value::Map(vec![
        (Value::Text("fmt".into()), Value::Text(fmt.into())),
        (Value::Text("attStmt".into()), Value::Map(vec![])),
        (Value::Text("authData".into()), Value::Bytes(auth)),
    ]))
}

fn sign(key: &SigningKey, auth: &[u8], client: &[u8]) -> Vec<u8> {
    let mut signed = auth.to_vec();
    signed.extend_from_slice(&Sha256::digest(client));
    let signature: Signature = key.sign(&signed);
    signature.to_der().as_bytes().to_vec()
}

fn registered(key: &SigningKey) -> Passkey {
    let client = client_data("webauthn.create", &CHALLENGE, ORIGIN);
    verify_registration(
        &Registration { client_data_json: &client, attestation_object: &attestation(key, RP, 0x45, "none", -7) },
        &expect(&CHALLENGE, &[ORIGIN], true),
    )
    .unwrap()
}

#[test]
fn a_passkey_is_registered_and_signs_in() {
    let key = SigningKey::random(&mut rand_core::OsRng);
    let pk = registered(&key);
    assert_eq!(pk.credential_id, b"cred");
    assert_eq!(pk.public_key.len(), 65);
    assert_eq!(pk.sign_count, 0);
    let (challenge, auth) = ([5u8; 32], head(RP, 0x05, 7));
    let client = client_data("webauthn.get", &challenge, ORIGIN);
    let a = Assertion { client_data_json: &client, authenticator_data: &auth, signature: &sign(&key, &auth, &client) };
    assert_eq!(verify_assertion(&a, &pk, &expect(&challenge, &[ORIGIN], false)), Ok(7));
}

#[test]
fn registration_refuses_what_it_should() {
    let key = SigningKey::random(&mut rand_core::OsRng);
    let ok = client_data("webauthn.create", &CHALLENGE, ORIGIN);
    let go =
        |client: &[u8], att: Vec<u8>, e: Expect| verify_registration(&Registration { client_data_json: client, attestation_object: &att }, &e).unwrap_err();
    let good = attestation(&key, RP, 0x45, "none", -7);
    assert_eq!(go(&client_data("webauthn.get", &CHALLENGE, ORIGIN), good.clone(), expect(&CHALLENGE, &[ORIGIN], true)), Problem::WrongCeremony);
    assert_eq!(go(&client_data("webauthn.create", &[1; 32], ORIGIN), good.clone(), expect(&CHALLENGE, &[ORIGIN], true)), Problem::WrongCeremony);
    assert_eq!(
        go(&client_data("webauthn.create", &CHALLENGE, "https://evil.example"), good.clone(), expect(&CHALLENGE, &[ORIGIN], true)),
        Problem::WrongOrigin
    );
    assert_eq!(go(&ok, attestation(&key, "other.example.org", 0x45, "none", -7), expect(&CHALLENGE, &[ORIGIN], true)), Problem::WrongRelyingParty);
    assert_eq!(go(&ok, attestation(&key, RP, 0x44, "none", -7), expect(&CHALLENGE, &[ORIGIN], true)), Problem::NotPresent);
    assert_eq!(go(&ok, attestation(&key, RP, 0x41, "none", -7), expect(&CHALLENGE, &[ORIGIN], true)), Problem::NotVerified);
    assert_eq!(go(&ok, attestation(&key, RP, 0x05, "none", -7), expect(&CHALLENGE, &[ORIGIN], true)), Problem::Malformed, "no credential data");
    assert_eq!(go(&ok, attestation(&key, RP, 0x45, "packed", -7), expect(&CHALLENGE, &[ORIGIN], true)), Problem::UnsupportedAttestation);
    assert_eq!(go(&ok, attestation(&key, RP, 0x45, "none", -257), expect(&CHALLENGE, &[ORIGIN], true)), Problem::UnsupportedKey);
    assert_eq!(go(&ok, vec![0xff, 0x00], expect(&CHALLENGE, &[ORIGIN], true)), Problem::Malformed);
    assert_eq!(go(b"not json", good.clone(), expect(&CHALLENGE, &[ORIGIN], true)), Problem::Malformed);
    // user verification is only demanded when asked for
    assert!(verify_registration(
        &Registration { client_data_json: &ok, attestation_object: &attestation(&key, RP, 0x41, "none", -7) },
        &expect(&CHALLENGE, &[ORIGIN], false)
    )
    .is_ok());
}

#[test]
fn sign_in_refuses_what_it_should() {
    let key = SigningKey::random(&mut rand_core::OsRng);
    let other = SigningKey::random(&mut rand_core::OsRng);
    let pk = Passkey { sign_count: 5, ..registered(&key) };
    let challenge = [5u8; 32];
    let try_it = |kind: &str, ch: &[u8], origin: &str, auth: &[u8], signer: &SigningKey, e: Expect| {
        let client = client_data(kind, ch, origin);
        verify_assertion(&Assertion { client_data_json: &client, authenticator_data: auth, signature: &sign(signer, auth, &client) }, &pk, &e)
    };
    let e = expect(&challenge, &[ORIGIN], false);
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x05, 6), &key, e.clone()), Ok(6));
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x05, 6), &other, e.clone()), Err(Problem::BadSignature), "another key");
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x05, 5), &key, e.clone()), Err(Problem::CounterWentBack));
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x05, 2), &key, e.clone()), Err(Problem::CounterWentBack));
    assert_eq!(try_it("webauthn.get", &[6; 32], ORIGIN, &head(RP, 0x05, 6), &key, e.clone()), Err(Problem::WrongCeremony), "replayed challenge");
    assert_eq!(try_it("webauthn.create", &challenge, ORIGIN, &head(RP, 0x05, 6), &key, e.clone()), Err(Problem::WrongCeremony));
    assert_eq!(try_it("webauthn.get", &challenge, "https://evil.example", &head(RP, 0x05, 6), &key, e.clone()), Err(Problem::WrongOrigin));
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head("other.example.org", 0x05, 6), &key, e.clone()), Err(Problem::WrongRelyingParty));
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x04, 6), &key, e.clone()), Err(Problem::NotPresent));
    assert_eq!(try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x01, 6), &key, expect(&challenge, &[ORIGIN], true)), Err(Problem::NotVerified));
    assert_eq!(
        try_it("webauthn.get", &challenge, ORIGIN, &head(RP, 0x05, 6), &key, expect(&challenge, &[ORIGIN], true)),
        Ok(6),
        "verified is fine when demanded"
    );
    // the signed data was changed after signing
    let client = client_data("webauthn.get", &challenge, ORIGIN);
    let auth = head(RP, 0x05, 6);
    let sig = sign(&key, &auth, &client);
    let tampered = head(RP, 0x05, 9);
    assert_eq!(verify_assertion(&Assertion { client_data_json: &client, authenticator_data: &tampered, signature: &sig }, &pk, &e), Err(Problem::BadSignature));
    assert_eq!(verify_assertion(&Assertion { client_data_json: &client, authenticator_data: &auth, signature: b"junk" }, &pk, &e), Err(Problem::Malformed));
    assert_eq!(verify_assertion(&Assertion { client_data_json: &client, authenticator_data: &auth[..10], signature: &sig }, &pk, &e), Err(Problem::Malformed));
}

#[test]
fn an_authenticator_that_never_counts_is_fine() {
    let key = SigningKey::random(&mut rand_core::OsRng);
    let pk = registered(&key);
    let (challenge, auth) = ([5u8; 32], head(RP, 0x05, 0));
    let client = client_data("webauthn.get", &challenge, ORIGIN);
    let a = Assertion { client_data_json: &client, authenticator_data: &auth, signature: &sign(&key, &auth, &client) };
    assert_eq!(verify_assertion(&a, &pk, &expect(&challenge, &[ORIGIN], false)), Ok(0));
    assert_eq!(verify_assertion(&a, &pk, &expect(&challenge, &[ORIGIN], false)), Ok(0), "same again: nothing to compare");
}
