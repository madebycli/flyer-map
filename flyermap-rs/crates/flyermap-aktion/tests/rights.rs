//! Who may do what in the Akteur, role by role and attack by attack. The rule itself is `flyermap_identity::decide` and is proved there; here it is
//! proved that the Akteur asks it about the right thing every time: the thing as stored, not as the caller says it is.
mod support;
use flyermap_protocol::{Art, Body, GebietIn, GruppeIn, Reason, Status, Why};
use support::{abholen, austeilen, gid, gr, gruppe_in, mark, marks, op, square, who, world::World, T0};

fn forbidden(why: Why) -> Reason {
    Reason::Forbidden { why }
}

fn a_mark(w: &World) -> Body {
    marks("n1", vec![mark("h:1", Status::Completed, op(w.now, "d"))])
}

#[test]
fn nobody_gets_in_without_a_grant_that_reaches_this_aktion() {
    let mut w = World::standard();
    for (caller, why) in [(who::nobody(), Why::NoGrant), (who::expired(), Why::Expired), (who::stranger(), Why::OutOfScope)] {
        let body = a_mark(&w);
        assert_eq!(w.no(&caller, body), forbidden(why), "{}", caller.principal);
        assert_eq!(w.no(&caller, gruppe_in("x", "x")), forbidden(why));
        assert_eq!(w.a.snapshot(&caller, w.now).unwrap_err(), forbidden(why));
        assert_eq!(w.a.catchup(&caller, w.now, 0, 10).unwrap_err(), forbidden(why));
        assert_eq!(w.a.marks_page(&caller, w.now, None, 10).unwrap_err(), forbidden(why));
        assert_eq!(w.a.notes_page(&caller, w.now, None, 10).unwrap_err(), forbidden(why));
    }
    // a label that cannot go into the log is no caller at all
    let nameless = who::with("", vec![flyermap_identity::Grant::new(flyermap_identity::Role::Admin, who::at_aktion())]);
    let body = a_mark(&w);
    assert_eq!(w.no(&nameless, body), forbidden(Why::NoGrant));
    assert!(w.a.snapshot(&nameless, w.now).is_err());
}

#[test]
fn a_member_marks_in_the_own_gruppe_and_nowhere_else() {
    let mut w = World::standard();
    let nord = who::member("nord");
    w.ok(&nord, marks("n1", vec![mark("h:1", Status::Completed, op(w.now, "d"))]));
    let sued = marks("s1", vec![mark("h:1", Status::Completed, op(w.now, "d"))]);
    assert_eq!(w.no(&nord, sued), forbidden(Why::OutOfScope), "the outline of s1 is known to a Member, its marks are not");
    let note = Body::Note { note: note_in("note-1", "s1", "h:1") };
    assert_eq!(w.no(&nord, note), forbidden(Why::OutOfScope));
    // looking is a right too
    assert_eq!(w.a.marks_page(&nord, w.now, None, 100).unwrap().marks.len(), 1);
    let viewer = who::viewer();
    assert_eq!(w.no(&viewer, a_mark(&w)), forbidden(Why::MissingCapability), "a Viewer looks only");
    assert_eq!(w.a.marks_page(&viewer, w.now, None, 100).unwrap().marks.len(), 1);
}

fn note_in(id: &str, gebiet: &str, key: &str) -> flyermap_protocol::NoteIn {
    flyermap_protocol::NoteIn {
        id: flyermap_protocol::NoteId::new(id),
        key: support::key(key),
        gebiet: gid(gebiet),
        flag: None,
        text: "klingel kaputt".to_string(),
        rev: op(T0, "d"),
        deleted: false,
    }
}

#[test]
fn ids_cannot_be_probed_by_somebody_who_may_not_know_the_gebiet() {
    let mut w = World::standard();
    w.ok(&who::admin(), abholen("main", None, square(13.1, 51.0, 0.01)));
    let helper = who::helper("h1");
    // n1 exists but is Austeilen; a Helper does not know it. The answer is the one for a Gebiet that is not there.
    let existing = w.no(&helper, a_mark(&w));
    let missing = w.no(&helper, marks("zzz", vec![mark("h:1", Status::Completed, op(w.now, "d"))]));
    assert_eq!(existing, Reason::NotFound);
    assert_eq!(existing, missing);
    // ... and for any other command that names a Gebiet
    let remove = Body::GebietRemove { id: gid("n1"), base_rev: 1 };
    assert_eq!(w.no(&helper, remove), Reason::NotFound);
    assert_eq!(w.no(&helper, Body::Collect { gebiet: gid("n1") }), Reason::NotFound);
    assert_eq!(w.no(&helper, Body::Release { gebiet: gid("n1") }), Reason::NotFound);
    // a Helper does know the Abholen outline, but may not mark in it before taking it over
    let main_marks = marks("main", vec![mark("h:1", Status::Completed, op(w.now, "d"))]);
    assert_eq!(w.no(&helper, main_marks), forbidden(Why::MissingCapability));
}

#[test]
fn only_the_aktion_creates_gruppen_and_a_lead_draws_in_the_own_gruppe_only() {
    let mut w = World::standard();
    let lead = who::lead("nord");
    for caller in [who::lead("nord"), who::member("nord"), who::viewer(), who::helper("h1")] {
        let reason = w.no(&caller, gruppe_in("neu", "neu"));
        assert!(matches!(reason, Reason::Forbidden { .. }), "{} created a Gruppe", caller.principal);
    }
    // draws in the own Gruppe, not in another and not without one
    w.ok(&lead, austeilen("n2", Some("nord"), square(13.0, 51.01, 0.005)));
    assert_eq!(w.no(&lead, austeilen("s2", Some("sued"), square(13.01, 51.01, 0.005))), forbidden(Why::OutOfScope));
    assert_eq!(w.no(&lead, austeilen("free", None, square(13.02, 51.01, 0.005))), forbidden(Why::OutOfScope));
    w.ok(&who::admin(), austeilen("free", None, square(13.02, 51.01, 0.005)));
    // members do not draw
    assert_eq!(w.no(&who::member("nord"), austeilen("n3", Some("nord"), square(13.0, 51.02, 0.005))), forbidden(Why::MissingCapability));
    // the Lead changes the own Gruppe but neither another one nor the Aktion's list
    let rename = |id: &str, base_rev| Body::Gruppe { gruppe: GruppeIn { id: gr(id), name: "Neu".into(), color: 1, base_rev } };
    w.ok(&lead, rename("nord", 1));
    assert_eq!(w.no(&lead, rename("sued", 1)), forbidden(Why::OutOfScope));
    assert_eq!(w.no(&lead, Body::GruppeRemove { id: gr("nord"), base_rev: 2 }), forbidden(Why::OutOfScope));
}

#[test]
fn a_gebiet_cannot_be_taken_by_claiming_it() {
    let mut w = World::standard();
    let lead_nord = who::lead("nord");
    // s1 belongs to sued; the Lead of nord says it is nord's and redraws it
    let claim = Body::Gebiet {
        gebiet: GebietIn { id: gid("s1"), art: Art::Austeilen, gruppe: Some(gr("nord")), parent: None, name: "mine".into(), ring: square(13.01, 51.0, 0.005), base_rev: 1 },
    };
    assert_eq!(w.no(&lead_nord, claim), forbidden(Why::OutOfScope));
    // handing n1 to sued takes the right in both Gruppen, and the Lead has one
    let give = Body::Gebiet {
        gebiet: GebietIn { id: gid("n1"), art: Art::Austeilen, gruppe: Some(gr("sued")), parent: None, name: "n1".into(), ring: square(13.0, 51.0, 0.005), base_rev: 1 },
    };
    assert_eq!(w.no(&lead_nord, give.clone()), forbidden(Why::OutOfScope));
    w.ok(&who::admin(), give);
    // now the Lead of nord has lost it
    let after = Body::GebietRemove { id: gid("n1"), base_rev: 2 };
    assert_eq!(w.no(&lead_nord, after), forbidden(Why::OutOfScope));
}

#[test]
fn cleaning_and_handing_over_marks_take_the_right_to_draw() {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(&admin, austeilen("n2", Some("nord"), square(13.0, 51.01, 0.005)));
    w.ok(&who::member("nord"), a_mark(&w));
    let keys = vec![support::key("h:1")];
    let to_n2 = Body::Move { from: gid("n1"), to: gid("n2"), keys: keys.clone() };
    assert_eq!(w.no(&who::member("nord"), to_n2.clone()), forbidden(Why::MissingCapability));
    assert_eq!(w.no(&who::lead("sued"), to_n2.clone()), forbidden(Why::OutOfScope));
    w.ok(&who::lead("nord"), to_n2);
    let clean = Body::Cleanup { gebiet: gid("n2"), keys: Some(keys), expect: flyermap_protocol::Counts { marks: 1, notes: 0 } };
    assert_eq!(w.no(&who::member("nord"), clean.clone()), forbidden(Why::MissingCapability));
    w.ok(&who::lead("nord"), clean);
}

#[test]
fn the_live_feed_shows_each_device_only_what_its_caller_may_see() {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(&admin, gruppe_in("west", "west"));
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    let first = w.ok(&who::member("nord"), a_mark(&w));
    assert!(first.is_accepted());
    // one command per Gebiet, the answer's broadcast and audience are what a host would hand to the connections
    let handled = w.send(&admin, marks("s1", vec![mark("h:9", Status::Later, op(w.now, "d"))]));
    let handled_group = w.send(&admin, gruppe_in("ost", "ost"));
    let handled_main = w.send(&admin, Body::Note { note: note_in("n-main", "main", "a:main") });
    let all: Vec<_> = [handled, handled_group, handled_main].into_iter().collect();
    let seen = |caller: &flyermap_aktion::Caller| -> Vec<String> {
        all.iter().flat_map(|h| h.audience.filter(caller, w.now, &h.broadcast)).map(|e| e.change.kind().to_string()).collect()
    };
    assert_eq!(seen(&admin), ["mark-set", "gruppe-set", "note-set"]);
    assert_eq!(seen(&who::viewer()), ["mark-set", "gruppe-set", "note-set"]);
    assert_eq!(seen(&who::member("nord")), ["gruppe-set"], "not the marks of sued, not the notes of an Abholen Gebiet");
    assert_eq!(seen(&who::member("sued")), ["mark-set", "gruppe-set"]);
    assert_eq!(seen(&who::helper("h1")), ["gruppe-set", "note-set"], "a Helper reads the Abholen world and nothing of the other");
    assert_eq!(seen(&who::stranger()), Vec::<String>::new());
    assert_eq!(seen(&who::nobody()), Vec::<String>::new());
    assert_eq!(seen(&who::expired()), Vec::<String>::new());
}
