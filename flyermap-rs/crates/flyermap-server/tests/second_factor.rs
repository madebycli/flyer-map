mod support;
use flyermap_identity::totp;
use serde_json::json;
use support::*;

fn step(w: &World) -> u64 {
    w.clock.get() / 1000 / 30
}

fn enroll(w: &World, cookie: &str) -> Vec<u8> {
    let r = w.post("/v6/totp/enroll", json!({}), Some(cookie));
    assert_eq!(r.status, 200, "{:?} {:?}", r.json, w.errors());
    assert!(r.json["uri"].as_str().unwrap().starts_with("otpauth://totp/"));
    totp::base32_decode(r.json["secret"].as_str().unwrap()).unwrap()
}

#[test]
fn the_second_factor_is_optional_and_then_required() {
    let w = World::new();
    let (cookie, _) = w.organisation("anna");
    let login = |extra: serde_json::Value| {
        let mut body = json!({ "handle": "anna", "password": "correct horse battery" });
        body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        w.post("/v6/session/password", body, None)
    };
    assert_eq!(login(json!({})).status, 200, "no factor yet");

    let secret = enroll(&w, &cookie);
    assert_eq!(login(json!({})).status, 200, "enrolled but not confirmed counts for nothing");
    let wrong = w.post("/v6/totp/confirm", json!({ "code": "000000" }), Some(&cookie));
    assert_eq!(wrong.code(), "invalid_credentials");
    let code = totp::code(&secret, step(&w));
    let confirmed = w.post("/v6/totp/confirm", json!({ "code": code }), Some(&cookie));
    assert_eq!(confirmed.status, 200, "{:?}", confirmed.json);
    let recovery: Vec<String> = confirmed.json["recovery_codes"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
    assert_eq!(recovery.len(), 8);
    assert_eq!(w.get("/v6/me", &cookie).json["credentials"]["totp"], true);
    assert_eq!(w.post("/v6/totp/enroll", json!({}), Some(&cookie)).code(), "conflict", "an active factor is not replaced silently");

    // password alone is not enough any more
    assert_eq!(login(json!({})).code(), "second_factor_required");
    assert_eq!(login(json!({ "totp": "123456" })).code(), "invalid_credentials");
    // the code that confirmed is spent; the next step's code works once
    assert_eq!(login(json!({ "totp": totp::code(&secret, step(&w)) })).code(), "invalid_credentials");
    w.advance(30_000);
    let fresh = totp::code(&secret, step(&w));
    assert_eq!(login(json!({ "totp": fresh })).status, 200);
    assert_eq!(login(json!({ "totp": fresh })).code(), "invalid_credentials", "a code works once");

    // a recovery code stands in for the app, once
    assert_eq!(login(json!({ "recovery_code": recovery[0] })).status, 200);
    assert_eq!(login(json!({ "recovery_code": recovery[0] })).code(), "invalid_credentials");
    assert_eq!(w.get("/v6/me", &cookie).json["credentials"]["recovery_codes_left"], 7);
    // switching the factor off needs a valid code
    assert_eq!(w.call("DELETE", "/v6/totp", Some(json!({ "code": "123456" })), Some(&cookie)).code(), "invalid_credentials");
    w.advance(30_000);
    let off = w.call("DELETE", "/v6/totp", Some(json!({ "code": totp::code(&secret, step(&w)) })), Some(&cookie));
    assert_eq!(off.status, 200, "{:?}", off.json);
    assert_eq!(login(json!({})).status, 200);
}

#[test]
fn recovery_codes_open_the_door_when_everything_else_is_gone() {
    let w = World::new();
    let (cookie, _) = w.organisation("anna");
    let r = w.post("/v6/recovery-codes", json!({}), Some(&cookie));
    let codes: Vec<String> = r.json["recovery_codes"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
    assert_eq!(codes.len(), 8);
    let go = |code: &str| w.post("/v6/session/recovery", json!({ "handle": "anna", "code": code }), None);
    assert_eq!(go("AAAA-AAAA-AAAA").code(), "invalid_credentials");
    let ok = go(&codes[2].to_lowercase());
    assert_eq!(ok.status, 200);
    assert_eq!(ok.json["me"]["session"]["via"], "recovery");
    assert_eq!(go(&codes[2]).code(), "invalid_credentials", "once");
    // new codes replace the old ones
    let again = w.post("/v6/recovery-codes", json!({}), Some(&cookie));
    assert_ne!(again.json["recovery_codes"], r.json["recovery_codes"]);
    assert_eq!(go(&codes[3]).code(), "invalid_credentials");
    // guessing is braked
    for _ in 0..8 {
        go("BBBB-BBBB-BBBB");
    }
    let fresh = again.json["recovery_codes"][0].as_str().unwrap().to_string();
    assert_eq!(go(&fresh).code(), "rate_limited");
}

#[test]
fn without_a_seal_key_the_factor_cannot_start() {
    let w = World::with(&[("SEAL_KEY", "")]);
    let (cookie, _) = w.organisation("anna");
    assert_eq!(w.post("/v6/totp/enroll", json!({}), Some(&cookie)).code(), "internal");
}
