//! Every shape of the protocol survives JSON unchanged, and the shapes that other code depends on are pinned as text: a renamed field or code fails here
//! first, not in a phone.
use flyermap_protocol::*;
use serde::{de::DeserializeOwned, Serialize};
use std::collections::BTreeSet;

fn round<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(value: &T) -> String {
    let json = serde_json::to_string(value).unwrap();
    let back: T = serde_json::from_str(&json).unwrap();
    assert_eq!(&back, value, "{json}");
    json
}

fn gebiet_id(s: &str) -> GebietId {
    GebietId::new(s)
}
fn op(n: u32) -> OpId {
    OpId::new(format!("0000000{n:04}-0000-dev"))
}
fn ring() -> Ring {
    vec![[13.0, 51.0], [13.001, 51.0], [13.001, 51.001], [13.0, 51.0]]
}
fn gebiet() -> Gebiet {
    Gebiet {
        id: gebiet_id("g1"),
        art: Art::Abholen,
        gruppe: None,
        parent: Some(gebiet_id("main")),
        name: "Teil".into(),
        ring: ring(),
        rev: 3,
        collected: Some(Collected { by: "p:1".into(), at: 1_800_000_000_000 }),
    }
}
fn lauf() -> Lauf {
    Lauf {
        id: LaufId::new("l1"),
        gebiet: gebiet_id("g1"),
        persons: 4,
        join: Join::Link,
        status: LaufStatus::Ended,
        started_at: 10,
        ended_at: Some(20),
        houses: 7,
        by: "p:1".into(),
        rev: 2,
    }
}
fn notiz() -> Notiz {
    Notiz {
        id: NoteId::new("n1"),
        key: Key::house("w1"),
        gebiet: gebiet_id("g1"),
        flag: Some(Flag::Locked),
        text: "Tor".into(),
        rev: op(1),
        deleted: false,
        by: "p:1".into(),
    }
}

fn every_body() -> Vec<Body> {
    vec![
        Body::Marks { gebiet: gebiet_id("g1"), marks: vec![MarkIn { key: Key::house("a"), status: Status::Completed, op: op(1) }] },
        Body::Note {
            note: NoteIn { id: NoteId::new("n1"), key: Key::new("a:g1"), gebiet: gebiet_id("g1"), flag: None, text: String::new(), rev: op(2), deleted: true },
        },
        Body::Gruppe { gruppe: GruppeIn { id: GruppeId::new("nord"), name: "Nord".into(), color: 3, base_rev: 0 } },
        Body::GruppeRemove { id: GruppeId::new("nord"), base_rev: 4 },
        Body::Gebiet {
            gebiet: GebietIn {
                id: gebiet_id("g1"),
                art: Art::Austeilen,
                gruppe: Some(GruppeId::new("nord")),
                parent: None,
                name: "Eins".into(),
                ring: ring(),
                base_rev: 0,
            },
        },
        Body::GebietRemove { id: gebiet_id("g1"), base_rev: 2 },
        Body::Collect { gebiet: gebiet_id("g1") },
        Body::Release { gebiet: gebiet_id("g1") },
        Body::RunStart { run: LaufIn { id: LaufId::new("l1"), gebiet: gebiet_id("g1"), persons: 2, join: Join::Team } },
        Body::RunUpdate { id: LaufId::new("l1"), persons: Some(3), join: None },
        Body::RunEnd { id: LaufId::new("l1") },
        Body::Cleanup { gebiet: gebiet_id("g1"), keys: Some(vec![Key::house("a")]), expect: Counts { marks: 1, notes: 0 } },
        Body::Cleanup { gebiet: gebiet_id("g1"), keys: None, expect: Counts { marks: 10, notes: 2 } },
        Body::Move { from: gebiet_id("g1"), to: gebiet_id("g2"), keys: vec![Key::house("a"), Key::segment("b")] },
    ]
}

fn every_change() -> Vec<Change> {
    vec![
        Change::MarkSet { gebiet: gebiet_id("g1"), key: Key::house("a"), status: Status::Later, op: op(1) },
        Change::MarksRemoved { gebiet: gebiet_id("g1"), keys: vec![Key::house("a")], rev: op(2) },
        Change::NoteSet { note: notiz() },
        Change::HandedOver { from: gebiet_id("g1"), to: gebiet_id("g2"), keys: vec![Key::house("a")], notes: vec![NoteId::new("n1")] },
        Change::NotesRemoved { gebiet: gebiet_id("g1"), ids: vec![NoteId::new("n1")], rev: op(3) },
        Change::GruppeSet { gruppe: Gruppe { id: GruppeId::new("nord"), name: "Nord".into(), color: 1, rev: 1 } },
        Change::GruppeRemoved { id: GruppeId::new("nord"), rev: 2 },
        Change::GebietSet { gebiet: gebiet() },
        Change::GebietRemoved { id: gebiet_id("g1"), rev: 4 },
        Change::Collected { gebiet: gebiet_id("g1"), by: "p:1".into(), at: 5 },
        Change::Released { gebiet: gebiet_id("g1") },
        Change::LaufSet { lauf: lauf() },
        Change::LaufEnded { lauf: lauf() },
    ]
}

fn every_reason() -> Vec<Reason> {
    vec![
        Reason::Forbidden { why: Why::OutOfScope },
        Reason::NotFound,
        Reason::BadId,
        Reason::BadKey,
        Reason::BadName,
        Reason::BadText,
        Reason::BadValue,
        Reason::BadClock,
        Reason::ClockSkew,
        Reason::BadRing { fault: RingFault::SelfCrossing },
        Reason::TooLarge { limit: 500 },
        Reason::LimitReached { limit: 9 },
        Reason::Exists,
        Reason::Deleted,
        Reason::NotDeleted,
        Reason::RevMismatch { current: 7 },
        Reason::WrongArt,
        Reason::BadParent,
        Reason::OutsideParent,
        Reason::Overlaps { with: Some(gebiet_id("g9")) },
        Reason::Overlaps { with: None },
        Reason::HasChildren,
        Reason::InUse,
        Reason::NotFree,
        Reason::NotCollected,
        Reason::NotLeaf,
        Reason::RunActive,
        Reason::RunEnded,
        Reason::KeyOwnedElsewhere,
        Reason::ConfirmMismatch { marks: 3, notes: 1 },
        Reason::CidReused,
        Reason::Storage,
    ]
}

#[test]
fn every_command_round_trips_and_has_its_own_kind() {
    let mut kinds = BTreeSet::new();
    for body in every_body() {
        round(&Command { cid: CommandId::new("c1"), body: body.clone() });
        kinds.insert(body.kind());
    }
    assert_eq!(kinds.len(), 13, "one kind per command: {kinds:?}");
}

#[test]
fn every_change_and_entry_round_trips_and_has_its_own_kind() {
    let mut kinds = BTreeSet::new();
    for (i, change) in every_change().into_iter().enumerate() {
        kinds.insert(change.kind());
        round(&Entry { seq: i as u64 + 1, at: 1_800_000_000_000, by: "p:1".into(), change });
    }
    assert_eq!(kinds.len(), 13);
}

#[test]
fn reasons_carry_a_stable_code_that_is_the_serialized_one() {
    let mut codes = BTreeSet::new();
    for reason in every_reason() {
        let json = round(&reason);
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["code"], reason.code(), "{json}");
        codes.insert(reason.code());
        round(&Verdict::rejected(reason.clone()));
        round(&Answer { cid: CommandId::new("c"), verdict: Verdict::Rejected { reason } });
    }
    assert_eq!(codes.len(), 31, "the codes are all different");
}

#[test]
fn the_shapes_others_depend_on_are_pinned() {
    let mark = Command {
        cid: CommandId::new("c1"),
        body: Body::Marks { gebiet: gebiet_id("g1"), marks: vec![MarkIn { key: Key::house("a"), status: Status::NotDeliverable, op: OpId::new("x") }] },
    };
    assert_eq!(round(&mark), r#"{"cid":"c1","body":{"t":"marks","gebiet":"g1","marks":[{"key":"h:a","status":"not-deliverable","op":"x"}]}}"#);
    let entry = Entry { seq: 4, at: 9, by: "p:1".into(), change: Change::Released { gebiet: gebiet_id("g1") } };
    assert_eq!(round(&entry), r#"{"seq":4,"at":9,"by":"p:1","change":{"t":"released","gebiet":"g1"}}"#);
    let refused = Verdict::Accepted {
        applied: 2,
        stale: 1,
        refused: vec![Refused { index: 3, reason: Reason::KeyOwnedElsewhere }],
        orphans: Some(Counts { marks: 5, notes: 0 }),
    };
    assert_eq!(
        round(&refused),
        r#"{"t":"accepted","applied":2,"stale":1,"refused":[{"index":3,"reason":{"code":"key_owned_elsewhere"}}],"orphans":{"marks":5,"notes":0}}"#
    );
    assert_eq!(round(&Verdict::accepted(1)), r#"{"t":"accepted","applied":1,"stale":0}"#);
    assert_eq!(
        round(&Verdict::rejected(Reason::Forbidden { why: Why::MissingCapability })),
        r#"{"t":"rejected","reason":{"code":"forbidden","why":"missing_capability"}}"#
    );
    assert_eq!(round(&Verdict::rejected(Reason::RevMismatch { current: 7 })), r#"{"t":"rejected","reason":{"code":"rev_mismatch","current":7}}"#);
}

#[test]
fn optional_fields_may_be_missing_and_are_left_out() {
    let json = r#"{"id":"g1","art":"austeilen","name":"x","ring":[[1.0,2.0]],"rev":1}"#;
    let g: Gebiet = serde_json::from_str(json).unwrap();
    assert_eq!((&g.gruppe, &g.parent, &g.collected), (&None, &None, &None));
    let note = r#"{"id":"n","key":"h:1","gebiet":"g","text":"","rev":"r"}"#;
    let n: NoteIn = serde_json::from_str(note).unwrap();
    assert!(!n.deleted && n.flag.is_none(), "a note is not deleted unless it says so");
    let out = serde_json::to_string(&g).unwrap();
    assert!(!out.contains("gruppe") && !out.contains("parent") && !out.contains("collected"), "{out}");
    let accepted: Verdict = serde_json::from_str(r#"{"t":"accepted","applied":1}"#).unwrap();
    assert_eq!(accepted, Verdict::accepted(1));
}

#[test]
fn views_round_trip() {
    round(&Snapshot { head: 9, floor: 2, server_now: 5, gruppen: vec![], gebiete: vec![gebiet()], laeufe: vec![lauf()] });
    let mark = Mark { key: Key::house("a"), gebiet: gebiet_id("g1"), status: Status::Completed, op: op(1), by: "p:1".into() };
    round(&MarksPage { marks: vec![mark], next: Some(MarkCursor { gebiet: gebiet_id("g1"), key: Key::house("a") }) });
    round(&MarksPage { marks: vec![], next: None });
    round(&NotesPage { notes: vec![notiz()], next: Some(NoteCursor { gebiet: gebiet_id("g1"), id: NoteId::new("n1") }) });
    let entry = Entry { seq: 1, at: 1, by: "p".into(), change: Change::Released { gebiet: gebiet_id("g1") } };
    round(&Catchup::Entries { entries: vec![entry], next: 1, head: 3, more: true });
    round(&Catchup::Resync { head: 3, floor: 2 });
    round(&PushRequest { commands: every_body().into_iter().map(|body| Command { cid: CommandId::new("c"), body }).collect() });
    round(&PushReply { answers: vec![Answer { cid: CommandId::new("c"), verdict: Verdict::accepted(1) }], head: 4, server_now: 6 });
}

#[test]
fn frames_carry_the_version_and_round_trip() {
    let command = Command { cid: CommandId::new("c"), body: Body::Collect { gebiet: gebiet_id("g1") } };
    for msg in [ClientMsg::Command { command }, ClientMsg::Subscribe { since: Some(4) }, ClientMsg::Subscribe { since: None }, ClientMsg::Ping { n: 1 }] {
        let frame = ClientFrame::new(msg);
        assert!(frame.is_supported());
        round(&frame);
    }
    let entry = Entry { seq: 1, at: 1, by: "p".into(), change: Change::Released { gebiet: gebiet_id("g1") } };
    let server = [
        ServerMsg::Hello { head: 1, floor: 0, server_now: 2, you: You { principal: "p:1".into() } },
        ServerMsg::Entries { entries: vec![entry], head: 1 },
        ServerMsg::Resync { head: 5, floor: 4 },
        ServerMsg::Answer { answer: Answer { cid: CommandId::new("c"), verdict: Verdict::accepted(1) }, head: 5 },
        ServerMsg::Presence { presence: Presence { online: vec![Online { principal: "p:1".into(), lauf: Some(LaufId::new("l1")) }] } },
        ServerMsg::Pong { n: 1 },
        ServerMsg::Error { code: ProtocolError::Version },
    ];
    for msg in server {
        let frame = ServerFrame::new(msg);
        assert!(frame.is_supported());
        round(&frame);
    }
    assert_eq!(round(&ClientFrame::new(ClientMsg::Ping { n: 7 })), r#"{"v":6,"msg":{"t":"ping","n":7}}"#);
    assert_eq!(round(&ServerFrame::new(ServerMsg::Pong { n: 7 })), r#"{"v":6,"msg":{"t":"pong","n":7}}"#);
    assert!(!ClientFrame { v: 5, msg: ClientMsg::Ping { n: 1 } }.is_supported());
}

#[test]
fn a_change_names_its_gebiet() {
    for change in every_change() {
        let gebiet = change.gebiet().map(GebietId::as_str);
        match change {
            Change::GruppeSet { .. } | Change::GruppeRemoved { .. } => assert_eq!(gebiet, None),
            _ => assert_eq!(gebiet, Some("g1"), "{}", change.kind()),
        }
    }
}

#[test]
fn the_protocol_holds_no_german() {
    // Texts are the app's. The codes and tags are English and ASCII.
    for reason in every_reason() {
        assert!(reason.code().chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{}", reason.code());
    }
    for body in every_body() {
        assert!(body.kind().is_ascii());
    }
}
