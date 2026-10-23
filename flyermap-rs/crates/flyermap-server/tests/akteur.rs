//! The way from a device to the Akteur of an Aktion, through the real edge (sessions, invitations, grants) and the real Akteur, over in-memory SQLite.
//! Who gets in, who gets what, what a refusal looks like, and that nothing a client sends can pose as the edge.
mod support;
use flyermap_protocol::{Command, CommandId};
use serde_json::json;
use support::{aktion::*, *};

#[test]
fn the_owner_builds_an_aktion_and_reads_it_back() {
    let s = setup();
    let snap = s.w.get(&format!("/v6/aktionen/{}/snapshot", s.aktion), &s.owner);
    assert_eq!(snap.status, 200, "{:?}", snap.json);
    assert_eq!(snap.json["gruppen"].as_array().unwrap().len(), 2);
    assert_eq!(snap.json["gebiete"].as_array().unwrap().len(), 2);
    assert_eq!(snap.json["head"], 4, "four commands, four entries");
    let verdict = s.w.command(&s.owner, &s.aktion, marks("n1", &["h:1", "h:2"], 1_800_000_000_000));
    assert_eq!(verdict["applied"], 2);
    let page = s.w.get(&format!("/v6/aktionen/{}/marks", s.aktion), &s.owner);
    assert_eq!(page.json["marks"].as_array().unwrap().len(), 2);
    let again = s.w.get(&format!("/v6/aktionen/{}/catchup?since=4", s.aktion), &s.owner);
    assert_eq!(again.json["t"], "entries");
    assert_eq!(again.json["entries"].as_array().unwrap().len(), 2, "one entry per mark that won");
}

#[test]
fn a_stranger_gets_nothing_and_wakes_nothing() {
    let w = World::new();
    let (anna, org) = w.organisation("anna");
    let aktion = w.aktion(&anna, &org);
    let (emil, _) = w.organisation("emil");
    for part in ["snapshot", "marks", "notes", "catchup?since=0"] {
        let r = w.get(&format!("/v6/aktionen/{aktion}/{part}"), &emil);
        assert_eq!((r.status, r.code()), (404, "not_found"), "{part}");
    }
    assert_eq!(w.push(&emil, &aktion, &[]).code(), "not_found");
    assert_eq!(w.connect(&emil, &aktion).unwrap_err().code(), "not_found");
    assert_eq!(w.get(&format!("/v6/aktionen/{aktion}/snapshot"), "").status, 401, "no session at all");
    assert_eq!(w.get("/v6/aktionen/no-such-aktion/snapshot", &anna).status, 404);
    assert_eq!(w.app.akteure.woken(), 0, "no Akteur was started for any of this");
}

#[test]
fn nothing_a_client_sends_can_pose_as_the_edge() {
    let s = setup();
    let (emil, _) = s.w.organisation("emil");
    // a link as the edge would make it, for an admin: the client cannot hand it over
    let forged = flyermap_server::akteur::Link::new(
        &s.org,
        &s.aktion,
        "per_forged",
        "ses_forged",
        &flyermap_identity::AccessSet::new(vec![flyermap_identity::Grant::new(
            flyermap_identity::Role::Owner,
            flyermap_identity::Scope::Organisation { org: flyermap_identity::OrgId::new(&s.org) },
        )]),
    )
    .encode();
    let r = s.w.call_with("GET", &format!("/v6/aktionen/{}/snapshot", s.aktion), None, Some(&emil), &[("x-fm-link", &forged)]);
    assert_eq!(r.code(), "not_found");
    let r = s.w.call_with("GET", &format!("/v6/aktionen/{}/snapshot", s.aktion), None, Some(&s.owner), &[("x-fm-link", &forged)]);
    assert_eq!(r.status, 200, "a request with the header is served as what the session is, not as what the header says");
}

#[test]
fn the_answer_to_a_refused_command_is_an_answer_and_rights_come_from_the_grants() {
    let s = setup();
    let nord = member_of(&s, "nord");
    assert_eq!(s.w.command(&nord, &s.aktion, marks("n1", &["h:1"], 1_800_000_000_100))["applied"], 1, "a member marks in the Gruppe's Gebiet");
    let verdict = s.w.command(&nord, &s.aktion, marks("s1", &["h:1"], 1_800_000_000_200));
    assert_eq!((verdict["t"].as_str(), reason(&verdict)), (Some("rejected"), "forbidden"), "and not in another Gruppe's");
    let viewer = s.w.guest(&s.owner, "viewer", json!({ "kind": "aktion", "org": s.org, "aktion": s.aktion }));
    assert_eq!(s.w.get(&format!("/v6/aktionen/{}/snapshot", s.aktion), &viewer).status, 200);
    assert_eq!(reason(&s.w.command(&viewer, &s.aktion, marks("n1", &["h:9"], 1_800_000_000_300))), "forbidden", "a viewer reads only");
    assert_eq!(reason(&s.w.command(&viewer, &s.aktion, gruppe("neu"))), "forbidden");
}

#[test]
fn a_grant_that_ends_ends_the_access_at_once() {
    let s = setup();
    let nord = member_of(&s, "nord");
    let path = format!("/v6/aktionen/{}/snapshot", s.aktion);
    assert_eq!(s.w.get(&path, &nord).status, 200);
    let grant =
        s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &s.owner).json["people"].as_array().unwrap().iter().find(|p| p["role"] == "member").unwrap()
            ["grant_id"]
            .as_str()
            .unwrap()
            .to_string();
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{grant}"), None, Some(&s.owner)).status, 200);
    assert_eq!(s.w.get(&path, &nord).code(), "not_found", "the directory is the truth, the next request already knows");
}

#[test]
fn the_edge_guards_what_it_forwards() {
    let s = setup();
    let path = format!("/v6/aktionen/{}/push", s.aktion);
    let text = s.w.call_with("POST", &path, None, Some(&s.owner), &[("content-type", "text/plain")]);
    assert_eq!(text.code(), "unsupported_media_type");
    assert_eq!(s.w.call("GET", &path, None, Some(&s.owner)).code(), "method_not_allowed");
    assert_eq!(s.w.call("POST", &format!("/v6/aktionen/{}/snapshot", s.aktion), Some(json!({})), Some(&s.owner)).code(), "method_not_allowed");
    let huge = s.w.post(&path, json!({ "commands": [], "pad": "x".repeat(2 * 1024 * 1024) }), Some(&s.owner));
    assert_eq!(huge.code(), "too_large");
    let broken = s.w.post(&path, json!({ "commands": "no" }), Some(&s.owner));
    assert_eq!((broken.status, broken.code()), (400, "malformed"));
    let too_many: Vec<Command> = (0..101).map(|i| Command { cid: CommandId::new(format!("c{i}")), body: gruppe("x") }).collect();
    assert_eq!(s.w.push(&s.owner, &s.aktion, &too_many).json["error"]["code"], "too_large");
}

#[test]
fn an_archived_aktion_can_be_read_but_not_changed() {
    let s = setup();
    futures::executor::block_on(flyermap_server::directory::aktionen::archive(&s.w.app.db, &s.aktion, s.w.clock.get())).unwrap();
    assert_eq!(s.w.get(&format!("/v6/aktionen/{}/snapshot", s.aktion), &s.owner).status, 200);
    let r = s.w.push(&s.owner, &s.aktion, &[Command { cid: CommandId::new("late"), body: gruppe("spaet") }]);
    assert_eq!((r.status, r.code()), (403, "forbidden"));
}

#[test]
fn a_dead_akteur_is_unavailable_and_the_cause_stays_in_the_log() {
    let s = setup();
    s.w.app.akteure.set_down(true);
    let r = s.w.get(&format!("/v6/aktionen/{}/snapshot", s.aktion), &s.owner);
    assert_eq!((r.status, r.code()), (503, "unavailable"));
    assert!(!r.json.to_string().contains("down for the test"), "what went wrong is for the log, not for the client");
    assert!(s.w.logs.borrow().iter().any(|l| l.contains("down for the test")));
}
