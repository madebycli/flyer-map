mod support;
use serde_json::{json, Value};
use support::*;

struct Setup {
    w: World,
    owner: String,
    org: String,
    aktion: String,
}

fn setup() -> Setup {
    let w = World::new();
    let (owner, org) = w.organisation("anna");
    let aktion = w.aktion(&owner, &org);
    Setup { w, owner, org, aktion }
}

fn gruppe(s: &Setup, g: &str) -> Value {
    json!({ "kind": "gruppe", "org": s.org, "aktion": s.aktion, "gruppe": g })
}

fn invite(s: &Setup, cookie: &str, role: &str, scope: Value, extra: Value) -> Reply {
    let mut body = json!({ "role": role, "scope": scope });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    s.w.post("/v6/invites", body, Some(cookie))
}

fn redeem(s: &Setup, code: &str, cookie: Option<&str>) -> Reply {
    s.w.post("/v6/invites/redeem", json!({ "code": code, "display_name": "Berta", "label": "Handy" }), cookie)
}

#[test]
fn a_guest_joins_with_a_code_and_the_code_is_used_up() {
    let s = setup();
    let made = invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({ "label": "Nord" }));
    assert_eq!(made.status, 201, "{:?}", made.json);
    let code = made.json["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 11, "ABCDE-FGHJK");
    assert!(made.json["link"].as_str().unwrap().starts_with("/beitreten/"));
    assert!(made.json["invite"].get("code_hash").is_none(), "the hash is not handed out");
    // typed the way people type it
    let joined = redeem(&s, &code.to_lowercase().replace('-', " "), None);
    assert_eq!(joined.status, 200, "{:?}", joined.json);
    let guest = joined.cookie.unwrap();
    assert_eq!(joined.json["aktion"]["name"], "Herbst");
    let me = s.w.get("/v6/me", &guest).json;
    assert_eq!((me["person"]["kind"].as_str(), me["person"]["display_name"].as_str()), (Some("guest"), Some("Berta")));
    assert_eq!(me["grants"][0]["role"], "member");
    assert_eq!(me["grants"][0]["scope"]["gruppe"], "nord");
    // single use
    assert_eq!(redeem(&s, &code, None).code(), "invite_invalid");
    // the guest sees the Aktion; a stranger does not
    assert_eq!(s.w.get("/v6/aktionen", &guest).json["aktionen"][0]["name"], "Herbst");
}

#[test]
fn wrong_codes_are_braked() {
    let s = setup();
    for _ in 0..8 {
        assert_eq!(redeem(&s, "ZZZZZ-ZZZZZ", None).code(), "invite_invalid");
    }
    let made = invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({}));
    assert_eq!(redeem(&s, made.json["code"].as_str().unwrap(), None).code(), "rate_limited", "even the right code waits");
    s.w.advance(11 * 60_000);
    assert_eq!(redeem(&s, made.json["code"].as_str().unwrap(), None).status, 200);
    assert_eq!(redeem(&s, "not a code", None).code(), "invite_invalid");
}

#[test]
fn invitations_end_by_time_by_use_and_by_hand() {
    let s = setup();
    let timed = invite(&s, &s.owner, "viewer", gruppe(&s, "nord"), json!({ "valid_hours": 1 }));
    s.w.advance(2 * 3_600_000);
    assert_eq!(redeem(&s, timed.json["code"].as_str().unwrap(), None).code(), "invite_invalid");
    let many = invite(&s, &s.owner, "viewer", gruppe(&s, "nord"), json!({ "max_uses": 2 }));
    let code = many.json["code"].as_str().unwrap();
    assert_eq!(redeem(&s, code, None).status, 200);
    assert_eq!(redeem(&s, code, None).status, 200);
    assert_eq!(redeem(&s, code, None).code(), "invite_invalid");
    let withdrawn = invite(&s, &s.owner, "viewer", gruppe(&s, "nord"), json!({}));
    let id = withdrawn.json["invite"]["id"].as_str().unwrap();
    assert_eq!(s.w.call("DELETE", &format!("/v6/invites/{id}"), None, Some(&s.owner)).status, 200);
    assert_eq!(redeem(&s, withdrawn.json["code"].as_str().unwrap(), None).code(), "invite_invalid");
}

#[test]
fn the_grant_of_a_guest_can_end_with_the_run() {
    let s = setup();
    let made = invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({ "grant_hours": 3 }));
    let guest = redeem(&s, made.json["code"].as_str().unwrap(), None).cookie.unwrap();
    assert_eq!(s.w.get("/v6/me", &guest).json["grants"].as_array().unwrap().len(), 1);
    s.w.advance(4 * 3_600_000);
    assert_eq!(s.w.get("/v6/me", &guest).json["grants"].as_array().unwrap().len(), 0, "ran out");
    assert_eq!(s.w.get("/v6/aktionen", &guest).json["aktionen"].as_array().unwrap().len(), 0);
}

#[test]
fn only_those_who_may_hand_out_a_role_can() {
    let s = setup();
    let guest = redeem(&s, invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({})).json["code"].as_str().unwrap(), None).cookie.unwrap();
    assert_eq!(invite(&s, &guest, "member", gruppe(&s, "nord"), json!({})).code(), "forbidden", "a member invites nobody");
    assert_eq!(
        invite(&s, &s.owner, "lead", json!({ "kind": "aktion", "org": s.org, "aktion": s.aktion }), json!({})).code(),
        "invalid_request",
        "a lead belongs to a Gruppe"
    );
    assert_eq!(invite(&s, &s.owner, "owner", json!({ "kind": "organisation", "org": s.org }), json!({})).status, 201);
    assert_eq!(invite(&s, &s.owner, "superuser", gruppe(&s, "nord"), json!({})).code(), "invalid_request");
    assert_eq!(invite(&s, &s.owner, "member", json!({ "kind": "nonsense" }), json!({})).code(), "invalid_request");
    // another Organisation's Aktion does not exist for us
    let (other, other_org) = s.w.organisation("bernd");
    let theirs = s.w.aktion(&other, &other_org);
    let foreign = json!({ "kind": "gruppe", "org": other_org, "aktion": theirs, "gruppe": "x" });
    assert_eq!(invite(&s, &s.owner, "member", foreign, json!({})).code(), "not_found");
    let wrong_pair = json!({ "kind": "gruppe", "org": s.org, "aktion": theirs, "gruppe": "x" });
    assert_eq!(invite(&s, &s.owner, "member", wrong_pair, json!({})).code(), "not_found", "an Aktion of another Organisation under our id");
}

#[test]
fn a_lead_runs_the_own_gruppe_and_nothing_else() {
    let s = setup();
    let lead = redeem(&s, invite(&s, &s.owner, "lead", gruppe(&s, "nord"), json!({})).json["code"].as_str().unwrap(), None).cookie.unwrap();
    let own = invite(&s, &lead, "member", gruppe(&s, "nord"), json!({}));
    assert_eq!(own.status, 201, "{:?}", own.json);
    assert_eq!(invite(&s, &lead, "lead", gruppe(&s, "nord"), json!({})).code(), "forbidden");
    assert_eq!(invite(&s, &lead, "member", gruppe(&s, "sued"), json!({})).code(), "not_found");
    assert_eq!(invite(&s, &lead, "helper", json!({ "kind": "aktion", "org": s.org, "aktion": s.aktion }), json!({})).code(), "not_found");
    let _ = redeem(&s, own.json["code"].as_str().unwrap(), None);
    let _ = redeem(&s, invite(&s, &s.owner, "member", gruppe(&s, "sued"), json!({})).json["code"].as_str().unwrap(), None);
    let people = s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &lead).json["people"].as_array().unwrap().clone();
    assert!(!people.is_empty());
    assert!(people.iter().all(|p| p["scope"]["gruppe"] == "nord"), "only the own Gruppe: {people:?}");
    let listed = s.w.get(&format!("/v6/invites?aktion={}", s.aktion), &lead).json["invites"].as_array().unwrap().clone();
    assert!(listed.iter().all(|i| i["scope"]["gruppe"] == "nord"));
}

#[test]
fn owners_and_admins_come_in_with_an_account_only() {
    let s = setup();
    let made = invite(&s, &s.owner, "admin", json!({ "kind": "aktion", "org": s.org, "aktion": s.aktion }), json!({}));
    let code = made.json["code"].as_str().unwrap();
    assert_eq!(redeem(&s, code, None).code(), "unauthorized", "a device without account");
    let (guest_cookie, _) = {
        let g = redeem(&s, invite(&s, &s.owner, "viewer", gruppe(&s, "nord"), json!({})).json["code"].as_str().unwrap(), None);
        (g.cookie.unwrap(), ())
    };
    assert_eq!(redeem(&s, code, Some(&guest_cookie)).code(), "unauthorized", "a guest");
    let (bernd, _) = s.w.organisation("bernd");
    let joined = redeem(&s, code, Some(&bernd));
    assert_eq!(joined.status, 200, "{:?}", joined.json);
    assert!(joined.cookie.is_none(), "the signed-in device keeps its session");
    let roles: Vec<_> = joined.json["me"]["grants"].as_array().unwrap().iter().map(|g| g["role"].as_str().unwrap().to_string()).collect();
    assert!(roles.contains(&"admin".to_string()) && roles.contains(&"owner".to_string()));
    // the admin can now invite into this Aktion, but cannot make owners
    assert_eq!(invite(&s, &bernd, "member", gruppe(&s, "nord"), json!({})).status, 201);
    assert_eq!(invite(&s, &bernd, "owner", json!({ "kind": "organisation", "org": s.org }), json!({})).code(), "not_found");
}

#[test]
fn grants_are_ended_and_the_last_owner_stays() {
    let s = setup();
    let guest = redeem(&s, invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({})).json["code"].as_str().unwrap(), None).cookie.unwrap();
    let people = s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &s.owner).json["people"].as_array().unwrap().clone();
    let theirs = people.iter().find(|p| p["kind"] == "guest").unwrap()["grant_id"].as_str().unwrap().to_string();
    let mine = people.iter().find(|p| p["role"] == "owner").unwrap()["grant_id"].as_str().unwrap().to_string();
    // the guest may not end anybody's grant, nor see the list
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{mine}"), None, Some(&guest)).code(), "not_found");
    assert_eq!(s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &guest).status, 403);
    // the last owner stays
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{mine}"), None, Some(&s.owner)).code(), "conflict");
    // ending the grant takes effect on the very next request
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{theirs}"), None, Some(&s.owner)).status, 200);
    assert_eq!(s.w.get("/v6/me", &guest).json["grants"].as_array().unwrap().len(), 0);
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{theirs}"), None, Some(&s.owner)).code(), "not_found");
    // leaving by oneself is always possible
    let again = redeem(&s, invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({})).json["code"].as_str().unwrap(), Some(&guest));
    let own = again.json["me"]["grants"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{own}"), None, Some(&guest)).status, 200);
}

#[test]
fn strangers_see_nothing_of_another_organisation() {
    let s = setup();
    let (stranger, _) = s.w.organisation("bernd");
    assert_eq!(s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &stranger).code(), "not_found");
    assert_eq!(s.w.get(&format!("/v6/invites?aktion={}", s.aktion), &stranger).json["invites"].as_array().unwrap().len(), 0);
    assert_eq!(s.w.post("/v6/aktionen", json!({ "org_id": s.org, "name": "Hack" }), Some(&stranger)).code(), "not_found");
    assert_eq!(s.w.get("/v6/aktionen", &stranger).json["aktionen"].as_array().unwrap().len(), 0);
    assert_eq!(s.w.get(&format!("/v6/audit?org={}", s.org), &stranger).code(), "not_found");
}

#[test]
fn the_audit_log_is_for_owners_and_holds_no_secrets() {
    let s = setup();
    let made = invite(&s, &s.owner, "member", gruppe(&s, "nord"), json!({}));
    let code = made.json["code"].as_str().unwrap().to_string();
    let guest = redeem(&s, &code, None).cookie.unwrap();
    assert_eq!(s.w.get(&format!("/v6/audit?org={}", s.org), &guest).status, 403);
    let entries = s.w.get(&format!("/v6/audit?org={}", s.org), &s.owner).json["entries"].as_array().unwrap().clone();
    let actions: Vec<_> = entries.iter().map(|e| e["action"].as_str().unwrap()).collect();
    for expected in ["organisation.create", "aktion.create", "invite.create", "invite.redeem"] {
        assert!(actions.contains(&expected), "{expected} in {actions:?}");
    }
    let text = serde_json::to_string(&entries).unwrap();
    assert!(!text.contains(&code.replace('-', "")) && !text.contains("correct horse"), "the log holds a secret");
    assert!(entries[0]["seq"].as_u64() > entries[1]["seq"].as_u64(), "newest first");
}
