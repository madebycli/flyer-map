//! The Abholen world (main areas, sub-areas, taking over, giving back) and the Läufe (a shared outing with its window and its count).
mod support;
use flyermap_aktion::Limits;
use flyermap_protocol::{Body, Change, Join, Lauf, LaufId, LaufIn, LaufStatus, Reason, Status, Verdict, Why};
use support::{abholen, austeilen, gid, mark, marks, op, square, who, world::World, T0};

fn start(id: &str, gebiet: &str) -> Body {
    Body::RunStart { run: LaufIn { id: LaufId::new(id), gebiet: gid(gebiet), persons: 3, join: Join::Team } }
}

fn laeufe(w: &mut World, caller: &flyermap_aktion::Caller) -> Vec<Lauf> {
    w.a.snapshot(caller, w.now).unwrap().laeufe
}

fn world_with_main() -> World {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    w.ok(&admin, abholen("part-a", Some("main"), square(13.1, 51.0, 0.005)));
    w.ok(&admin, abholen("part-b", Some("main"), square(13.105, 51.0, 0.005)));
    w
}

#[test]
fn a_main_area_holds_sub_areas_inside_it_that_do_not_overlap() {
    let mut w = world_with_main();
    let admin = who::admin();
    assert_eq!(w.no(&admin, abholen("out", Some("main"), square(13.2, 51.0, 0.005))), Reason::OutsideParent);
    assert_eq!(w.no(&admin, abholen("over", Some("main"), square(13.102, 51.002, 0.005))), Reason::Overlaps { with: Some(gid("part-a")) });
    assert_eq!(w.no(&admin, abholen("deep", Some("part-a"), square(13.1, 51.0, 0.001))), Reason::BadParent, "a sub-area has no sub-areas");
    assert_eq!(w.no(&admin, abholen("lost", Some("nowhere"), square(13.1, 51.0, 0.001))), Reason::BadParent);
    assert_eq!(w.no(&admin, abholen("of-austeilen", Some("n1"), square(13.0, 51.0, 0.001))), Reason::BadParent);
    assert_eq!(w.no(&admin, austeilen("verteil", None, square(13.1, 51.0, 0.001)).with_parent("main")), Reason::WrongArt);
    // the main area cannot shrink away from its parts, nor be deleted with parts in it
    let shrink = Body::Gebiet {
        gebiet: flyermap_protocol::GebietIn {
            id: gid("main"),
            art: flyermap_protocol::Art::Abholen,
            gruppe: None,
            parent: None,
            name: "main".into(),
            ring: square(13.1, 51.0, 0.006),
            base_rev: 1,
        },
    };
    assert_eq!(w.no(&admin, shrink), Reason::OutsideParent);
    assert_eq!(w.no(&admin, Body::GebietRemove { id: gid("main"), base_rev: 1 }), Reason::HasChildren);
    w.ok(&admin, Body::GebietRemove { id: gid("part-a"), base_rev: 1 });
    w.ok(&admin, abholen("part-c", Some("main"), square(13.1, 51.0, 0.004)));
    w.assert_replays();
}

trait WithParent {
    fn with_parent(self, parent: &str) -> Body;
}
impl WithParent for Body {
    fn with_parent(self, parent: &str) -> Body {
        match self {
            Body::Gebiet { mut gebiet } => {
                gebiet.parent = Some(gid(parent));
                Body::Gebiet { gebiet }
            }
            other => other,
        }
    }
}

#[test]
fn a_helper_takes_a_free_leaf_over_and_the_admin_or_the_taker_gives_it_back() {
    let mut w = world_with_main();
    let (admin, anna, ben) = (who::admin(), who::helper("anna"), who::helper("ben"));
    assert_eq!(w.no(&anna, Body::Collect { gebiet: gid("main") }), Reason::NotLeaf);
    let taken = w.send(&anna, Body::Collect { gebiet: gid("part-a") });
    assert!(taken.reply.verdict.is_accepted());
    assert!(matches!(&taken.broadcast[0].change, Change::Collected { by, at, .. } if by == "anna" && *at == w.now));
    assert_eq!(w.no(&ben, Body::Collect { gebiet: gid("part-a") }), Reason::NotFree);
    assert_eq!(w.no(&anna, Body::Collect { gebiet: gid("part-a") }), Reason::NotFree, "not twice");
    // marking is a grant at the Gebiet, which whoever owns the grants made on seeing `Collected`
    assert_eq!(w.no(&anna, marks("part-a", vec![mark("h:1", Status::Completed, op(T0, "a"))])), Reason::Forbidden { why: Why::MissingCapability });
    let anna_at = who::helper_at("anna", "part-a");
    w.ok(&anna_at, marks("part-a", vec![mark("h:1", Status::Completed, op(T0, "a"))]));
    let ben_at_b = who::helper_at("ben", "part-b");
    assert_eq!(w.no(&ben_at_b, marks("part-a", vec![mark("h:2", Status::Completed, op(T0, "a"))])), Reason::Forbidden { why: Why::MissingCapability });
    // a taken Gebiet is not deleted and not redrawn into the main area's way
    assert_eq!(w.no(&admin, Body::GebietRemove { id: gid("part-a"), base_rev: 1 }), Reason::InUse);
    // giving back
    assert_eq!(w.no(&ben, Body::Release { gebiet: gid("part-a") }), Reason::Forbidden { why: Why::MissingCapability });
    assert_eq!(w.no(&ben, Body::Release { gebiet: gid("part-b") }), Reason::NotCollected);
    let released = w.send(&anna, Body::Release { gebiet: gid("part-a") });
    assert!(released.reply.verdict.is_accepted());
    assert!(matches!(released.broadcast[0].change, Change::Released { .. }));
    w.ok(&ben, Body::Collect { gebiet: gid("part-a") });
    w.ok(&admin, Body::Release { gebiet: gid("part-a") });
    // Austeilen has nothing to collect
    assert_eq!(w.no(&admin, Body::Collect { gebiet: gid("n1") }), Reason::WrongArt);
    assert_eq!(w.no(&anna, Body::Collect { gebiet: gid("n1") }), Reason::NotFound);
    w.assert_replays();
}

#[test]
fn nothing_is_added_to_a_main_area_that_is_taken_over_whole() {
    let mut w = World::standard();
    let (admin, anna) = (who::admin(), who::helper("anna"));
    w.ok(&admin, abholen("solo", None, square(13.1, 51.0, 0.01)));
    w.ok(&anna, Body::Collect { gebiet: gid("solo") });
    assert_eq!(w.no(&admin, abholen("part", Some("solo"), square(13.1, 51.0, 0.002))), Reason::InUse);
    w.ok(&admin, Body::Release { gebiet: gid("solo") });
    w.ok(&admin, abholen("part", Some("solo"), square(13.1, 51.0, 0.002)));
    assert_eq!(w.no(&anna, Body::Collect { gebiet: gid("solo") }), Reason::NotLeaf, "it has a part now");
}

#[test]
fn who_may_open_a_lauf_and_how_many_run_at_once() {
    let mut w = World::with(Limits { max_active_runs: 2, ..Limits::default() });
    let admin = who::admin();
    for (g, x) in [("nord", 13.00), ("sued", 13.01), ("west", 13.02)] {
        w.ok(&admin, support::gruppe_in(g, g));
        w.ok(&admin, austeilen(&format!("{g}-1"), Some(g), square(x, 51.0, 0.005)));
    }
    assert_eq!(w.no(&who::member("nord"), start("l0", "nord-1")), Reason::Forbidden { why: Why::MissingCapability });
    assert_eq!(w.no(&who::viewer(), start("l0", "nord-1")), Reason::Forbidden { why: Why::MissingCapability });
    assert_eq!(w.no(&who::lead("sued"), start("l0", "nord-1")), Reason::Forbidden { why: Why::OutOfScope });
    assert_eq!(w.no(&admin, start("l0", "nowhere")), Reason::NotFound);
    assert_eq!(
        w.no(&admin, Body::RunStart { run: LaufIn { id: LaufId::new("l0"), gebiet: gid("nord-1"), persons: 1000, join: Join::Closed } }),
        Reason::BadValue
    );
    w.ok(&who::lead("nord"), start("l1", "nord-1"));
    assert_eq!(w.no(&admin, start("l2", "nord-1")), Reason::RunActive, "one at a time in a Gebiet");
    assert_eq!(w.no(&admin, start("l1", "sued-1")), Reason::Exists);
    w.ok(&admin, start("l2", "sued-1"));
    assert_eq!(w.no(&admin, start("l3", "west-1")), Reason::LimitReached { limit: 2 });
    w.ok(&who::lead("nord"), Body::RunEnd { id: LaufId::new("l1") });
    w.ok(&admin, start("l3", "west-1"));
    // a Lauf is seen by those who read its Gebiet
    let names = |l: Vec<Lauf>| l.into_iter().map(|l| l.id.to_string()).collect::<Vec<_>>();
    assert_eq!(names(laeufe(&mut w, &who::member("sued"))), ["l2"].map(String::from));
    assert_eq!(names(laeufe(&mut w, &who::viewer())), ["l1", "l2", "l3"].map(String::from));
    assert!(laeufe(&mut w, &who::helper("h")).is_empty(), "a Helper reads the other world only");
}

#[test]
fn the_houses_of_a_lauf_are_counted_from_the_marks_stamped_within_its_window() {
    let mut w = World::standard();
    let (lead, member) = (who::lead("nord"), who::member("nord"));
    // a house done before the Lauf, with a stamp before it
    w.ok(&member, marks("n1", vec![mark("h:0", Status::Completed, op(T0 - 5000, "a"))]));
    w.tick(1000);
    let started = w.now;
    w.ok(&lead, start("l1", "n1"));
    assert_eq!(laeufe(&mut w, &lead)[0].houses, 0);
    w.tick(1000);
    let batch = vec![
        mark("h:1", Status::Completed, op(started + 100, "a")),
        mark("h:2", Status::Completed, op(started + 200, "a")),
        mark("s:1", Status::Completed, op(started + 200, "a")),
        mark("h:3", Status::Later, op(started + 300, "a")),
        mark("h:4", Status::Completed, op(started - 100, "a")),
    ];
    let handled = w.send(&member, marks("n1", batch));
    let changes: Vec<_> = handled.broadcast.iter().map(|e| e.change.kind()).collect();
    assert_eq!(changes.iter().filter(|k| **k == "lauf-set").count(), 1, "the Lauf is told once per command: {changes:?}");
    let lauf = laeufe(&mut w, &lead).remove(0);
    assert_eq!((lauf.houses, lauf.rev), (2, 2), "streets, other statuses and stamps before the start do not count");
    // a house undone, then done again; the same edit again changes nothing
    w.ok(&member, marks("n1", vec![mark("h:1", Status::Open, op(started + 400, "a"))]));
    assert_eq!(laeufe(&mut w, &lead)[0].houses, 1);
    let head = w.a.head();
    w.ok(&member, marks("n1", vec![mark("h:1", Status::Open, op(started + 400, "a"))]));
    assert_eq!(w.a.head(), head);
    // ending counts the window; an edit from a phone that was offline during the Lauf still counts when it arrives later
    w.tick(60_000);
    let ended_at = w.now;
    w.ok(&lead, Body::RunEnd { id: LaufId::new("l1") });
    let lauf = laeufe(&mut w, &lead).remove(0);
    assert_eq!((lauf.status, lauf.ended_at, lauf.houses), (LaufStatus::Ended, Some(ended_at), 1));
    w.tick(60_000);
    w.ok(&member, marks("n1", vec![mark("h:5", Status::Completed, op(started + 5000, "offline"))]));
    assert_eq!(laeufe(&mut w, &lead)[0].houses, 2);
    w.ok(&member, marks("n1", vec![mark("h:6", Status::Completed, op(ended_at + 5000, "offline"))]));
    assert_eq!(laeufe(&mut w, &lead)[0].houses, 2, "stamped after the end: not this Lauf's");
    // the count is the count of the marks, whatever happened in between
    w.assert_replays();
}

#[test]
fn a_lauf_is_changed_while_it_runs_and_ended_once() {
    let mut w = World::standard();
    let lead = who::lead("nord");
    w.ok(&lead, start("l1", "n1"));
    let update = |persons, join| Body::RunUpdate { id: LaufId::new("l1"), persons, join };
    w.ok(&lead, update(Some(5), None));
    w.ok(&lead, update(None, Some(Join::Link)));
    let lauf = laeufe(&mut w, &lead).remove(0);
    assert_eq!((lauf.persons, lauf.join, lauf.rev, lauf.by.as_str()), (5, Join::Link, 3, "lead-nord"));
    let Verdict::Accepted { applied, stale, .. } = w.ok(&lead, update(Some(5), Some(Join::Link))) else { unreachable!() };
    assert_eq!((applied, stale), (0, 1));
    assert_eq!(w.no(&lead, update(Some(1000), None)), Reason::BadValue);
    assert_eq!(w.no(&who::member("nord"), update(Some(1), None)), Reason::Forbidden { why: Why::MissingCapability });
    assert_eq!(w.no(&who::lead("sued"), update(Some(1), None)), Reason::Forbidden { why: Why::OutOfScope });
    assert_eq!(w.no(&lead, Body::RunEnd { id: LaufId::new("nope") }), Reason::NotFound);
    let ended = w.send(&lead, Body::RunEnd { id: LaufId::new("l1") });
    assert!(matches!(ended.broadcast.last().map(|e| &e.change), Some(Change::LaufEnded { .. })), "the host ends the guests' access on this");
    assert_eq!(w.no(&lead, update(Some(1), None)), Reason::RunEnded);
    assert_eq!(w.no(&lead, Body::RunEnd { id: LaufId::new("l1") }), Reason::RunEnded);
    // a new Lauf can open in the same Gebiet now
    w.ok(&lead, start("l2", "n1"));
    w.assert_replays();
}
