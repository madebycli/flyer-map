mod support;
use serde_json::json;
use support::*;

#[test]
fn an_organisation_needs_the_setup_key() {
    let w = World::new();
    let body = json!({ "name": "Verein", "owner": { "handle": "anna", "password": "correct horse battery" } });
    assert_eq!(w.post("/v6/organisations", body.clone(), None).code(), "signup_closed");
    assert_eq!(w.call_with("POST", "/v6/organisations", Some(body.clone()), None, &[("x-setup-key", "wrong")]).code(), "signup_closed");
    let ok = w.call_with("POST", "/v6/organisations", Some(body.clone()), None, &[("x-setup-key", SETUP_KEY)]);
    assert_eq!(ok.status, 201);
    assert!(ok.cookie.as_deref().unwrap().starts_with("__Host-fm="));
    assert_eq!(ok.json["me"]["grants"][0]["role"], "owner");
    assert_eq!(ok.json["me"]["grants"][0]["scope"]["kind"], "organisation");
    assert_eq!(w.call_with("POST", "/v6/organisations", Some(body), None, &[("x-setup-key", SETUP_KEY)]).code(), "conflict", "handle taken");
    // open sign-up when the deployment allows it
    let open = World::with(&[("OPEN_SIGNUP", "1")]);
    assert_eq!(open.post("/v6/organisations", json!({ "name": "Neu", "owner": { "handle": "bernd", "password": "correct horse battery" } }), None).status, 201);
}

#[test]
fn organisation_input_is_checked() {
    let w = World::new();
    let go = |owner: serde_json::Value, name: &str| {
        w.call_with("POST", "/v6/organisations", Some(json!({ "name": name, "owner": owner })), None, &[("x-setup-key", SETUP_KEY)])
    };
    assert_eq!(go(json!({ "handle": "anna", "password": "short" }), "V").code(), "invalid_request");
    assert_eq!(go(json!({ "handle": "a b", "password": "correct horse battery" }), "V").code(), "invalid_request");
    assert_eq!(go(json!({ "password": "correct horse battery" }), "V").code(), "invalid_request");
    assert_eq!(go(json!({ "handle": "anna", "password": "correct horse battery" }), "").code(), "invalid_request");
    let r = w.call_with("POST", "/v6/organisations", Some(json!([1])), None, &[("x-setup-key", SETUP_KEY)]);
    assert_eq!(r.code(), "invalid_request");
    let no_json = w.call_with("POST", "/v6/organisations", None, None, &[("x-setup-key", SETUP_KEY)]);
    assert_eq!(no_json.code(), "unsupported_media_type");
}

#[test]
fn signing_in_with_a_password_and_the_brake() {
    let w = World::new();
    w.organisation("anna");
    let body = |pw: &str| json!({ "handle": "Anna", "password": pw, "label": "Pixel" });
    let ok = w.post("/v6/session/password", body("correct horse battery"), None);
    assert_eq!(ok.status, 200);
    let cookie = ok.cookie.unwrap();
    assert_eq!(w.get("/v6/me", &cookie).json["person"]["handle"], "anna");
    // wrong password and unknown name look the same
    assert_eq!(w.post("/v6/session/password", body("wrong wrong wrong"), None).code(), "invalid_credentials");
    assert_eq!(w.post("/v6/session/password", json!({ "handle": "nobody", "password": "wrong wrong wrong" }), None).code(), "invalid_credentials");
    // the brake: 8 failures lock the name, even for the right password; the wait ends the lock
    for _ in 0..8 {
        w.post("/v6/session/password", body("wrong wrong wrong"), None);
    }
    assert_eq!(w.post("/v6/session/password", body("correct horse battery"), None).code(), "rate_limited");
    w.advance(11 * 60_000);
    assert_eq!(w.post("/v6/session/password", body("correct horse battery"), None).status, 200);
}

#[test]
fn sessions_end_and_nothing_secret_is_logged() {
    let w = World::new();
    let (owner, _) = w.organisation("anna");
    assert_eq!(w.get("/v6/me", &owner).status, 200);
    assert_eq!(w.call("GET", "/v6/me", None, None).code(), "unauthorized");
    assert_eq!(w.call("GET", "/v6/me", None, Some("__Host-fm=garbage")).code(), "unauthorized");
    // a Bearer token works like the cookie (apps that are not a browser)
    let token = owner.trim_start_matches("__Host-fm=");
    let bearer = w.call_with("GET", "/v6/me", None, None, &[("authorization", &format!("Bearer {token}"))]);
    assert_eq!(bearer.status, 200);
    // idle sessions expire, active ones are kept alive
    w.advance(29 * 86_400_000);
    assert_eq!(w.get("/v6/me", &owner).status, 200);
    w.advance(29 * 86_400_000);
    assert_eq!(w.get("/v6/me", &owner).status, 200, "used within the window, so extended");
    w.advance(31 * 86_400_000);
    assert_eq!(w.get("/v6/me", &owner).code(), "unauthorized");
    let logs = w.logs.borrow().join("\n");
    for secret in ["correct horse battery", token, SETUP_KEY] {
        assert!(!logs.contains(secret), "a log line holds a secret");
    }
    assert!(logs.contains("\"route\":\"/v6/me\""), "{logs}");
}

#[test]
fn writes_from_another_origin_are_refused() {
    let w = World::new();
    let (owner, _) = w.organisation("anna");
    let r = w.call_with("POST", "/v6/session/logout", Some(json!({})), Some(&owner), &[("origin", "https://evil.test")]);
    assert_eq!(r.code(), "cross_origin");
    assert_eq!(w.get("/v6/me", &owner).status, 200, "the session survived");
    assert_eq!(w.call("DELETE", "/v6/me", None, Some(&owner)).code(), "method_not_allowed");
    assert_eq!(w.call("GET", "/v6/nope", None, Some(&owner)).code(), "not_found");
}

#[test]
fn devices_are_listed_and_signed_out_one_by_one() {
    let w = World::new();
    let (first, _) = w.organisation("anna");
    let second = w.post("/v6/session/password", json!({ "handle": "anna", "password": "correct horse battery", "label": "Tablet" }), None).cookie.unwrap();
    let devices = w.get("/v6/devices", &first).json["devices"].as_array().unwrap().clone();
    assert_eq!(devices.len(), 2);
    assert_eq!(devices.iter().filter(|d| d["current"] == true).count(), 1);
    let other = devices.iter().find(|d| d["current"] == false).unwrap()["id"].as_str().unwrap().to_string();
    assert_eq!(w.call("DELETE", &format!("/v6/devices/{other}"), None, Some(&first)).status, 200);
    assert_eq!(w.get("/v6/me", &second).code(), "unauthorized");
    assert_eq!(w.call("DELETE", &format!("/v6/devices/{other}"), None, Some(&first)).code(), "not_found");
    assert_eq!(w.post("/v6/session/logout", json!({}), Some(&first)).status, 200);
    assert_eq!(w.get("/v6/me", &first).code(), "unauthorized");
}

#[test]
fn changing_the_password_signs_the_other_devices_out() {
    let w = World::new();
    let (first, _) = w.organisation("anna");
    let second = w.post("/v6/session/password", json!({ "handle": "anna", "password": "correct horse battery" }), None).cookie.unwrap();
    let wrong = w.post("/v6/me/password", json!({ "current": "not it at all", "new": "a new long password" }), Some(&first));
    assert_eq!(wrong.code(), "invalid_credentials");
    let weak = w.post("/v6/me/password", json!({ "current": "correct horse battery", "new": "short" }), Some(&first));
    assert_eq!(weak.code(), "invalid_request");
    let ok = w.post("/v6/me/password", json!({ "current": "correct horse battery", "new": "a new long password" }), Some(&first));
    assert_eq!((ok.status, ok.json["signed_out_devices"].as_u64()), (200, Some(1)));
    assert_eq!(w.get("/v6/me", &second).code(), "unauthorized");
    assert_eq!(w.get("/v6/me", &first).status, 200);
    assert_eq!(w.post("/v6/session/password", json!({ "handle": "anna", "password": "correct horse battery" }), None).code(), "invalid_credentials");
    assert_eq!(w.post("/v6/session/password", json!({ "handle": "anna", "password": "a new long password" }), None).status, 200);
}
