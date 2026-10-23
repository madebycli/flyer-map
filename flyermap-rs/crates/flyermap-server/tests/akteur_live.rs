//! The live channel of an Aktion through the real edge: what each device is told, who is online, and that connections end with the rights that let them in.
mod support;
use flyermap_protocol::{ClientMsg, Command, CommandId, ProtocolError, ServerFrame, ServerMsg};
use serde_json::json;
use support::{aktion::*, *};

#[test]
fn the_live_channel_tells_each_device_only_what_it_may_see() {
    let s = setup();
    let (nord, sued) = (member_of(&s, "nord"), member_of(&s, "sued"));
    let (co, cn, cs) = (s.w.connect(&s.owner, &s.aktion).unwrap(), s.w.connect(&nord, &s.aktion).unwrap(), s.w.connect(&sued, &s.aktion).unwrap());
    let a = &s.w.app.akteure;
    for c in [&co, &cn, &cs] {
        assert!(matches!(a.take(c)[0].msg, ServerMsg::Hello { head: 4, .. }), "greeted with where the log stands");
        a.send(&s.aktion, c, ClientMsg::Subscribe { since: None });
    }
    s.w.command(&s.owner, &s.aktion, marks("n1", &["h:1"], 1_800_000_000_500));
    let (owner_got, nord_got, sued_got) = (entries(&a.take(&co)), entries(&a.take(&cn)), entries(&a.take(&cs)));
    assert_eq!(owner_got.len(), 1);
    assert_eq!(nord_got.len(), 1, "the member of the Gruppe sees the mark");
    assert!(sued_got.is_empty(), "the member of another Gruppe is told nothing of it: {sued_got:?}");
    // a device's own command comes back as an answer and as news, in that order
    a.send(&s.aktion, &cn, ClientMsg::Command { command: Command { cid: CommandId::new("from-socket"), body: marks("n1", &["h:2"], 1_800_000_000_600) } });
    let frames = a.take(&cn);
    assert!(matches!(frames[0].msg, ServerMsg::Answer { .. }), "{frames:?}");
    assert_eq!(entries(&frames).len(), 1);
    assert_eq!(entries(&a.take(&co)).len(), 1, "and the owner is told");
    assert!(entries(&a.take(&cs)).is_empty());
}

#[test]
fn subscribing_from_a_position_catches_up_and_a_far_behind_device_is_told_to_resync() {
    let s = setup();
    let nord = member_of(&s, "nord");
    s.w.command(&s.owner, &s.aktion, marks("n1", &["h:1"], 1_800_000_000_500));
    s.w.command(&s.owner, &s.aktion, marks("s1", &["h:1"], 1_800_000_000_600));
    let c = s.w.connect(&nord, &s.aktion).unwrap();
    let a = &s.w.app.akteure;
    a.take(&c);
    a.send(&s.aktion, &c, ClientMsg::Subscribe { since: Some(4) });
    let got = entries(&a.take(&c));
    assert_eq!(got.len(), 1, "of the two marks the member may see one: {got:?}");
    a.send(&s.aktion, &c, ClientMsg::Subscribe { since: Some(10_000) });
    assert!(a.take(&c).iter().any(|f| matches!(f.msg, ServerMsg::Resync { .. })), "ahead of the log means the Aktion was reset");
}

#[test]
fn the_channel_drops_what_it_cannot_trust_and_answers_the_rest() {
    let s = setup();
    let a = &s.w.app.akteure;
    let c = s.w.connect(&s.owner, &s.aktion).unwrap();
    a.take(&c);
    a.send(&s.aktion, &c, ClientMsg::Ping { n: 7 });
    assert!(matches!(a.take(&c)[0].msg, ServerMsg::Pong { n: 7 }));
    a.send_raw(&s.aktion, &c, r#"{"v":5,"msg":{"t":"ping","n":1}}"#);
    assert_eq!(errors(&a.take(&c)), [ProtocolError::Version]);
    assert!(!a.is_open(&c));
    let c = s.w.connect(&s.owner, &s.aktion).unwrap();
    a.send_raw(&s.aktion, &c, "not a frame");
    assert_eq!(errors(&a.take(&c)), [ProtocolError::Malformed]);
    assert!(!a.is_open(&c));
    let c = s.w.connect(&s.owner, &s.aktion).unwrap();
    for _ in 0..61 {
        a.send(&s.aktion, &c, ClientMsg::Ping { n: 0 });
    }
    assert!(errors(&a.take(&c)).contains(&ProtocolError::Slow), "a flood is cut off");
    assert!(!a.is_open(&c));
}

#[test]
fn presence_follows_who_is_connected() {
    let s = setup();
    let a = &s.w.app.akteure;
    let anna = s.w.who(&s.owner);
    let nord_cookie = member_of(&s, "nord");
    let (c1, c2) = (s.w.connect(&s.owner, &s.aktion).unwrap(), s.w.connect(&nord_cookie, &s.aktion).unwrap());
    a.send(&s.aktion, &c1, ClientMsg::Subscribe { since: None });
    let online = |frames: Vec<ServerFrame>| -> Vec<String> {
        frames
            .into_iter()
            .rev()
            .find_map(|f| if let ServerMsg::Presence { presence } = f.msg { Some(presence.online.into_iter().map(|o| o.principal).collect()) } else { None })
            .unwrap_or_default()
    };
    let seen = online(a.take(&c1));
    assert!(seen.contains(&anna) && seen.len() == 2, "{seen:?}");
    a.disconnect(&s.aktion, &c2);
    assert_eq!(online(a.take(&c1)), [anna], "the one who left is gone");
}

#[test]
fn ending_rights_closes_exactly_the_connections_they_let_in() {
    let s = setup();
    let a = &s.w.app.akteure;
    // a second device of the owner
    let second = s.w.post("/v6/session/password", json!({ "handle": "anna", "password": "correct horse battery", "label": "Tablet" }), None).cookie.unwrap();
    let (phone, tablet) = (s.w.connect(&s.owner, &s.aktion).unwrap(), s.w.connect(&second, &s.aktion).unwrap());
    // 1. signing one device out closes that device's connection and no other
    let device = s.w.get("/v6/devices", &s.owner).json["devices"].as_array().unwrap().iter().find(|d| d["label"] == "Tablet").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(s.w.call("DELETE", &format!("/v6/devices/{device}"), None, Some(&s.owner)).status, 200);
    assert!(!a.is_open(&tablet) && a.is_open(&phone));
    assert_eq!(errors(&a.take(&tablet)), [ProtocolError::Forbidden]);
    // 2. a grant that ends closes every device of that person in the Aktion
    let nord_cookie = member_of(&s, "nord");
    let guest_phone = s.w.connect(&nord_cookie, &s.aktion).unwrap();
    let grant =
        s.w.get(&format!("/v6/aktionen/{}/people", s.aktion), &s.owner).json["people"].as_array().unwrap().iter().find(|p| p["role"] == "member").unwrap()
            ["grant_id"]
            .as_str()
            .unwrap()
            .to_string();
    assert_eq!(s.w.call("DELETE", &format!("/v6/grants/{grant}"), None, Some(&s.owner)).status, 200);
    assert!(!a.is_open(&guest_phone) && a.is_open(&phone));
    // 3. a new password signs the other devices out, the one that asked stays
    let third = s.w.post("/v6/session/password", json!({ "handle": "anna", "password": "correct horse battery", "label": "Laptop" }), None).cookie.unwrap();
    let laptop = s.w.connect(&third, &s.aktion).unwrap();
    let changed = s.w.post("/v6/me/password", json!({ "current": "correct horse battery", "new": "another long passphrase" }), Some(&s.owner));
    assert_eq!(changed.status, 200, "{:?}", changed.json);
    assert!(!a.is_open(&laptop) && a.is_open(&phone));
    // 4. signing out closes the connection of that session
    assert_eq!(s.w.post("/v6/session/logout", json!({}), Some(&s.owner)).status, 200);
    assert!(!a.is_open(&phone));
}

#[test]
fn a_failed_kick_does_not_undo_the_change_and_the_alarm_catches_up() {
    let s = setup();
    let a = &s.w.app.akteure;
    let conn = s.w.connect(&s.owner, &s.aktion).unwrap();
    // the Akteur is out of reach while the person signs out of the device: signing out still works, the log says what could not be done
    a.set_down(true);
    assert_eq!(s.w.post("/v6/session/logout", json!({}), Some(&s.owner)).status, 200);
    assert!(s.w.logs.borrow().iter().any(|l| l.contains("kick failed")));
    a.set_down(false);
    assert_eq!(s.w.get("/v6/me", &s.owner).status, 401, "the session is over whatever happened to the connection");
    assert!(a.is_open(&conn), "the connection is still there: only the kick failed");
}

#[test]
fn a_grant_that_runs_out_lapses_the_connection_when_the_alarm_looks() {
    use flyermap_identity::{AccessSet, Grant, Role, Scope};
    let s = setup();
    let a = &s.w.app.akteure;
    let now = s.w.clock.get();
    let scope = Scope::Aktion { org: flyermap_identity::OrgId::new(&s.org), aktion: flyermap_identity::AktionId::new(&s.aktion) };
    let link = flyermap_server::akteur::Link::new(
        &s.org,
        &s.aktion,
        "per_temp",
        "ses_temp",
        &AccessSet::new(vec![Grant::new(Role::Viewer, scope).until(now + 5_000)]),
    );
    let conn = a.connect(link);
    a.sweep(&s.aktion);
    assert!(a.is_open(&conn), "still valid");
    s.w.advance(5_000);
    a.sweep(&s.aktion);
    assert!(!a.is_open(&conn), "ran out");
}

#[test]
fn a_socket_from_another_site_is_refused() {
    let s = setup();
    let r = s.w.connect_from(&s.owner, &s.aktion, "https://evil.test").unwrap_err();
    assert_eq!((r.status, r.code()), (403, "cross_origin"));
    assert!(s.w.connect_from(&s.owner, &s.aktion, ORIGIN).is_ok());
}

#[test]
fn giving_a_gebiet_to_another_gruppe_sends_every_subscribed_device_to_a_new_snapshot() {
    let s = setup();
    let a = &s.w.app.akteure;
    let (nord, sued) = (member_of(&s, "nord"), member_of(&s, "sued"));
    let (cn, cs, idle) = (s.w.connect(&nord, &s.aktion).unwrap(), s.w.connect(&sued, &s.aktion).unwrap(), s.w.connect(&s.owner, &s.aktion).unwrap());
    for c in [&cn, &cs] {
        a.send(&s.aktion, c, ClientMsg::Subscribe { since: None });
    }
    let resyncs = |frames: Vec<ServerFrame>| frames.iter().filter(|f| matches!(f.msg, ServerMsg::Resync { .. })).count();
    for c in [&cn, &cs, &idle] {
        a.take(c);
    }
    // a new outline in the same Gruppe: nothing to resync
    assert_eq!(s.w.command(&s.owner, &s.aktion, gebiet_rev("n1", "nord", 0.001, 1))["t"], "accepted");
    assert_eq!((resyncs(a.take(&cn)), resyncs(a.take(&cs))), (0, 0));
    // given to the other Gruppe: the one that lost the right is not shown the entry that takes it away, so both are sent to a new snapshot
    assert_eq!(s.w.command(&s.owner, &s.aktion, gebiet_rev("n1", "sued", 0.001, 2))["t"], "accepted");
    assert_eq!((resyncs(a.take(&cn)), resyncs(a.take(&cs))), (1, 1));
    assert_eq!(resyncs(a.take(&idle)), 0, "a device that did not subscribe is not sent anything");
    // and the snapshot a device then takes is what its rights say now
    let seen = |cookie: &str| {
        s.w.get(&format!("/v6/aktionen/{}/snapshot", s.aktion), cookie).json["gebiete"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|g| g["gruppe"].as_str().map(str::to_string))
            .collect::<Vec<_>>()
    };
    assert!(seen(&s.owner).iter().filter(|g| *g == "sued").count() == 2, "n1 now belongs to sued, next to s1");
}
