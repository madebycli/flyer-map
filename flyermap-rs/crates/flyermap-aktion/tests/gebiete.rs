//! Gruppen and Gebiete: drawing, revisions, the worlds, deleting, and what happens to marks and notes that stay behind (orphans, clean-up, hand-over).
mod support;
use flyermap_protocol::{Art, Body, Counts, GebietIn, GruppeIn, NoteId, NoteIn, Reason, RingFault, Status, Verdict, Why};
use support::{abholen, austeilen, gid, gr, gruppe_in, key, mark, marks, op, square, who, world::World, T0};

fn edit(id: &str, gruppe: Option<&str>, ring: flyermap_protocol::Ring, base_rev: u64) -> Body {
    Body::Gebiet { gebiet: GebietIn { id: gid(id), art: Art::Austeilen, gruppe: gruppe.map(gr), parent: None, name: id.to_string(), ring, base_rev } }
}

fn applied_and_stale(verdict: Verdict) -> (u32, u32) {
    match verdict {
        Verdict::Accepted { applied, stale, .. } => (applied, stale),
        other => panic!("not accepted: {other:?}"),
    }
}

#[test]
fn gruppen_are_created_changed_and_removed_by_revision() {
    let mut w = World::new();
    let admin = who::admin();
    w.ok(&admin, gruppe_in("nord", " Nord "));
    assert_eq!(w.a.snapshot(&admin, w.now).unwrap().gruppen[0].name, "Nord", "trimmed");
    assert_eq!(w.no(&admin, gruppe_in("nord", "again")), Reason::Exists);
    let change = |name: &str, color, base_rev| Body::Gruppe { gruppe: GruppeIn { id: gr("nord"), name: name.into(), color, base_rev } };
    assert_eq!(w.no(&admin, change("Neu", 4, 7)), Reason::RevMismatch { current: 1 });
    assert_eq!(w.no(&admin, change("Neu", 99, 1)), Reason::BadValue);
    assert_eq!(w.no(&admin, change("  ", 4, 1)), Reason::BadName);
    assert_eq!(w.no(&admin, change("a\u{7}", 4, 1)), Reason::BadName);
    assert_eq!(w.no(&admin, change(&"x".repeat(81), 4, 1)), Reason::BadName);
    w.ok(&admin, change("Neu", 4, 1));
    // the same again is nothing new
    assert_eq!(applied_and_stale(w.ok(&admin, change("Neu", 4, 2))), (0, 1));
    assert_eq!(w.no(&admin, Body::GruppeRemove { id: gr("nord"), base_rev: 1 }), Reason::RevMismatch { current: 2 });
    // a Gruppe with Gebiete cannot go
    w.ok(&admin, austeilen("n1", Some("nord"), square(13.0, 51.0, 0.005)));
    assert_eq!(w.no(&admin, Body::GruppeRemove { id: gr("nord"), base_rev: 2 }), Reason::HasChildren);
    w.ok(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 1 });
    w.ok(&admin, Body::GruppeRemove { id: gr("nord"), base_rev: 2 });
    assert_eq!(w.no(&admin, Body::GruppeRemove { id: gr("nord"), base_rev: 3 }), Reason::Deleted);
    assert_eq!(w.no(&admin, gruppe_in("nord", "back")), Reason::Exists, "an id is never used twice");
    assert_eq!(w.no(&admin, austeilen("n9", Some("nord"), square(13.0, 51.1, 0.005))), Reason::BadParent, "no Gebiet for a Gruppe that is gone");
    assert_eq!(w.no(&admin, austeilen("n9", Some("nowhere"), square(13.0, 51.1, 0.005))), Reason::BadParent);
    w.assert_replays();
}

#[test]
fn a_gebiet_is_a_valid_outline_that_lies_over_no_other_of_its_world() {
    let mut w = World::standard();
    let admin = who::admin();
    // over n1 (13.00..13.005): refused, and the Admin is told which one
    assert_eq!(w.no(&admin, austeilen("x", None, square(13.002, 51.002, 0.005))), Reason::Overlaps { with: Some(gid("n1")) });
    // touching along a border is fine
    w.ok(&admin, austeilen("next", None, square(13.005, 51.0, 0.005)));
    let bow_tie = vec![[13.0, 51.1], [13.01, 51.11], [13.01, 51.1], [13.0, 51.11], [13.0, 51.1]];
    assert_eq!(w.no(&admin, austeilen("y", None, bow_tie)), Reason::BadRing { fault: RingFault::SelfCrossing });
    assert_eq!(w.no(&admin, austeilen("y", None, square(13.0, 51.1, 0.000001))), Reason::BadRing { fault: RingFault::TooSmall });
    assert_eq!(w.no(&admin, austeilen("y", None, vec![[13.0, 51.1], [13.1, 51.1]])), Reason::BadRing { fault: RingFault::TooFewPoints });
    let nan = vec![[f64::NAN, 51.1], [13.1, 51.1], [13.1, 51.2], [13.0, 51.2]];
    assert_eq!(w.no(&admin, austeilen("y", None, nan)), Reason::BadRing { fault: RingFault::BadCoordinate });
    let off_earth = vec![[200.0, 51.1], [201.0, 51.1], [201.0, 51.2], [200.0, 51.2]];
    assert_eq!(w.no(&admin, austeilen("y", None, off_earth)), Reason::BadRing { fault: RingFault::BadCoordinate });
    assert_eq!(w.no(&admin, austeilen("bad id", None, square(13.0, 51.1, 0.005))), Reason::BadId);
    assert_eq!(w.no(&admin, austeilen("n1", None, square(13.0, 51.1, 0.005))), Reason::Exists);
    // an open ring is closed for the device
    w.ok(&admin, austeilen("open", None, vec![[13.0, 51.1], [13.005, 51.1], [13.005, 51.105], [13.0, 51.105]]));
    let snapshot = w.a.snapshot(&admin, w.now).unwrap();
    let ring = &snapshot.gebiete.iter().find(|g| g.id == gid("open")).unwrap().ring;
    assert_eq!(ring.first(), ring.last());
    // the two worlds do not see each other: an Austeilen outline may lie over an Abholen one
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    w.ok(&admin, austeilen("over-main", None, square(13.1, 51.0, 0.005)));
    w.assert_replays();
}

#[test]
fn only_giving_a_gebiet_to_another_gruppe_tells_the_host_that_readers_changed() {
    // a reader of the old Gruppe loses the right; the entry that says so is about a Gebiet it may not see any more, so it never reaches it: the host
    // has to tell it to take a new snapshot
    let mut w = World::standard();
    let admin = who::admin();
    let redrawn = w.send(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.004), 1));
    assert!(redrawn.reply.verdict.is_accepted() && !redrawn.rights_moved, "a new outline moves no rights");
    let given = w.send(&admin, edit("n1", Some("sued"), square(13.0, 51.0, 0.004), 2));
    assert!(given.reply.verdict.is_accepted() && given.rights_moved, "a new Gruppe does");
    assert_eq!(given.floor, 0);
    let marked = w.send(&admin, marks("s1", vec![mark("h:1", Status::Completed, op(T0, "a"))]));
    assert!(marked.reply.verdict.is_accepted() && !marked.rights_moved);
    let refused = w.send(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.004), 1));
    assert!(!refused.reply.verdict.is_accepted() && !refused.rights_moved, "a refused command moved nothing");
}

#[test]
fn a_lead_drawing_over_the_gebiet_of_another_gruppe_is_refused_and_told_which() {
    // every outline of the own world is known to somebody who draws in it, so the name is given (it is withheld from a caller who may not see the outline)
    let mut w = World::standard();
    let lead = who::lead("nord");
    let over_s1 = austeilen("x", Some("nord"), square(13.01, 51.0, 0.002));
    assert_eq!(w.no(&lead, over_s1), Reason::Overlaps { with: Some(gid("s1")) });
}

#[test]
fn a_change_needs_the_revision_it_was_made_on_and_the_world_never_changes() {
    let mut w = World::standard();
    let admin = who::admin();
    assert_eq!(w.no(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.004), 5)), Reason::RevMismatch { current: 1 });
    w.ok(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.004), 1));
    // unchanged: nothing is written
    let head = w.a.head();
    assert_eq!(applied_and_stale(w.ok(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.004), 2))), (0, 1));
    assert_eq!(w.a.head(), head);
    // another world, another parent
    let as_abholen = Body::Gebiet {
        gebiet: GebietIn { id: gid("n1"), art: Art::Abholen, gruppe: None, parent: None, name: "n1".into(), ring: square(13.0, 51.0, 0.004), base_rev: 2 },
    };
    assert_eq!(w.no(&admin, as_abholen), Reason::WrongArt);
    // a Gebiet that grows over its neighbour is refused; one that shrinks or moves is not
    assert_eq!(w.no(&admin, edit("n1", Some("nord"), square(13.0, 51.0, 0.012), 2)), Reason::Overlaps { with: Some(gid("s1")) });
    w.ok(&admin, edit("n1", Some("sued"), square(13.0, 51.0, 0.004), 2));
    assert_eq!(w.no(&admin, edit("n1", Some("gone"), square(13.0, 51.0, 0.004), 3)), Reason::BadParent);
    // a Gruppe belongs to the world of Austeilen only
    let with_gruppe = Body::Gebiet {
        gebiet: GebietIn {
            id: gid("m"),
            art: Art::Abholen,
            gruppe: Some(gr("nord")),
            parent: None,
            name: "m".into(),
            ring: square(13.1, 51.0, 0.01),
            base_rev: 0,
        },
    };
    assert_eq!(w.no(&admin, with_gruppe), Reason::WrongArt);
    w.assert_replays();
}

fn note(id: &str, gebiet: &str, k: &str) -> NoteIn {
    NoteIn { id: NoteId::new(id), key: key(k), gebiet: gid(gebiet), flag: None, text: "t".into(), rev: op(T0, "a"), deleted: false }
}

fn with_orphans() -> World {
    let mut w = World::standard();
    let member = who::member("nord");
    let batch: Vec<_> = ["h:1", "h:2", "h:3", "s:1"].iter().map(|k| mark(k, Status::Completed, op(T0, "a"))).collect();
    w.ok(&member, marks("n1", batch));
    w.ok(&member, Body::Note { note: note("a", "n1", "h:1") });
    w.ok(&member, Body::Note { note: note("b", "n1", "a:n1") });
    w
}

#[test]
fn deleting_a_gebiet_leaves_its_marks_and_notes_as_orphans_which_the_answer_counts() {
    let mut w = with_orphans();
    let admin = who::admin();
    let Verdict::Accepted { orphans, .. } = w.ok(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 1 }) else { unreachable!() };
    assert_eq!(orphans, Some(Counts { marks: 4, notes: 2 }));
    // nobody reads them any more
    assert!(w.a.marks_page(&who::member("nord"), w.now, None, 100).unwrap().marks.is_empty());
    assert!(w.a.notes_page(&admin, w.now, None, 100).unwrap().notes.is_empty());
    assert_eq!(w.no(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 2 }), Reason::Deleted);
    // ids are never used again, so the orphans can never be mistaken for a new Gebiet's
    assert_eq!(w.no(&admin, austeilen("n1", Some("nord"), square(13.0, 51.0, 0.005))), Reason::Exists);
    // clean-up: only after seeing the numbers, and only by whoever may draw
    let clean = |marks, notes| Body::Cleanup { gebiet: gid("n1"), keys: None, expect: Counts { marks, notes } };
    assert_eq!(w.no(&admin, clean(3, 2)), Reason::ConfirmMismatch { marks: 4, notes: 2 });
    assert_eq!(w.no(&who::member("nord"), clean(4, 2)), Reason::Forbidden { why: Why::MissingCapability });
    assert_eq!(applied_and_stale(w.ok(&admin, clean(4, 2))).0, 6);
    let dump = w.a.dump().unwrap();
    assert!(dump.marks.iter().all(|(_, removed)| *removed) && dump.notes.iter().all(|n| n.deleted && n.text.is_empty()));
    // the second time there is nothing left, which is nothing to do
    assert_eq!(applied_and_stale(w.ok(&admin, clean(0, 0))), (0, 1));
    w.assert_replays();
}

#[test]
fn a_cleaned_mark_does_not_come_back_with_an_old_edit_and_a_live_gebiet_is_cleaned_by_keys() {
    let mut w = with_orphans();
    let admin = who::admin();
    // without keys, only a deleted Gebiet is cleaned
    let all = Body::Cleanup { gebiet: gid("n1"), keys: None, expect: Counts { marks: 4, notes: 2 } };
    assert_eq!(w.no(&admin, all), Reason::NotDeleted);
    // by keys, a live Gebiet gives up some marks and the notes on them
    let some = |expect| Body::Cleanup { gebiet: gid("n1"), keys: Some(vec![key("h:1"), key("h:2"), key("h:404")]), expect };
    assert_eq!(w.no(&admin, some(Counts { marks: 3, notes: 1 })), Reason::ConfirmMismatch { marks: 2, notes: 1 }, "h:404 is nowhere");
    w.tick(1000);
    w.ok(&admin, some(Counts { marks: 2, notes: 1 }));
    let member = who::member("nord");
    let left: Vec<_> = w.a.marks_page(&member, w.now, None, 100).unwrap().marks.into_iter().map(|m| m.key.to_string()).collect();
    assert_eq!(left, ["h:3", "s:1"]);
    // an edit stamped before the clean-up arrives late from a phone that was offline: it loses
    let (applied, stale) = applied_and_stale(w.ok(&member, marks("n1", vec![mark("h:1", Status::Completed, op(T0 + 10, "late"))])));
    assert_eq!((applied, stale), (0, 1));
    // one stamped after it is a new edit
    w.tick(1000);
    let fresh = op(w.now, "phone");
    assert_eq!(applied_and_stale(w.ok(&member, marks("n1", vec![mark("h:1", Status::Later, fresh)]))).0, 1);
    // bad keys and too many keys are refused
    let bad = Body::Cleanup { gebiet: gid("n1"), keys: Some(vec![key("x:1")]), expect: Counts::default() };
    assert_eq!(w.no(&admin, bad), Reason::BadKey);
    let none = Body::Cleanup { gebiet: gid("n1"), keys: Some(Vec::new()), expect: Counts::default() };
    assert_eq!(w.no(&admin, none), Reason::BadValue);
    let many = Body::Cleanup { gebiet: gid("n1"), keys: Some((0..501).map(|i| key(&format!("h:{i}"))).collect()), expect: Counts::default() };
    assert_eq!(w.no(&admin, many), Reason::TooLarge { limit: 500 });
    w.assert_replays();
}

#[test]
fn marks_and_notes_move_with_their_stamps_to_the_gebiet_that_took_the_piece() {
    let mut w = with_orphans();
    let admin = who::admin();
    w.ok(&admin, austeilen("n2", Some("nord"), square(13.0, 51.01, 0.005)));
    let before = w.a.marks_page(&admin, w.now, None, 100).unwrap().marks;
    let keys = vec![key("h:1"), key("h:3"), key("h:404")];
    let (applied, stale) = applied_and_stale(w.ok(&admin, Body::Move { from: gid("n1"), to: gid("n2"), keys: keys.clone() }));
    assert_eq!((applied, stale), (3, 1), "two marks and the note on h:1 moved, h:404 was not there");
    let page = w.a.marks_page(&admin, w.now, None, 100).unwrap().marks;
    let at = |g: &str| page.iter().filter(|m| m.gebiet == gid(g)).map(|m| m.key.to_string()).collect::<Vec<_>>();
    assert_eq!((at("n1"), at("n2")), (vec!["h:2".to_string(), "s:1".to_string()], vec!["h:1".to_string(), "h:3".to_string()]));
    for moved in page.iter().filter(|m| m.gebiet == gid("n2")) {
        let was = before.iter().find(|m| m.key == moved.key).unwrap();
        assert_eq!((was.status, &was.op), (moved.status, &moved.op), "the stamp travels with the mark");
    }
    // the note on h:1 is now n2's (pages go by Gebiet, then id); the note on the whole Gebiet stays
    let notes = w.a.notes_page(&admin, w.now, None, 100).unwrap().notes;
    assert_eq!(notes.iter().map(|n| (n.id.as_str(), n.gebiet.as_str())).collect::<Vec<_>>(), [("b", "n1"), ("a", "n2")]);
    // a move into the Gebiet it is already in, or between the worlds, or into a deleted one, is refused
    assert_eq!(w.no(&admin, Body::Move { from: gid("n1"), to: gid("n1"), keys: keys.clone() }), Reason::BadValue);
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    assert_eq!(w.no(&admin, Body::Move { from: gid("n1"), to: gid("main"), keys: keys.clone() }), Reason::WrongArt);
    w.ok(&admin, Body::GebietRemove { id: gid("n2"), base_rev: 1 });
    assert_eq!(w.no(&admin, Body::Move { from: gid("n1"), to: gid("n2"), keys }), Reason::Deleted);
    w.assert_replays();
}

#[test]
fn a_gebiet_with_a_running_lauf_or_taker_is_not_deleted() {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(
        &admin,
        Body::RunStart {
            run: flyermap_protocol::LaufIn { id: flyermap_protocol::LaufId::new("l1"), gebiet: gid("n1"), persons: 2, join: flyermap_protocol::Join::Team },
        },
    );
    assert_eq!(w.no(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 1 }), Reason::InUse);
    w.ok(&admin, Body::RunEnd { id: flyermap_protocol::LaufId::new("l1") });
    w.ok(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 1 });
    w.assert_replays();
}
