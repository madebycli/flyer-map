//! All or nothing: a command whose storage dies halfway leaves nothing behind and can be sent again; an Aktion reopened is the one that was closed; the
//! log can be compacted and replayed.
mod support;
use flyermap_aktion::{Aktion, Limits, OpenError, ReplayError, RusqliteSql, Sql};
use flyermap_protocol::{Body, Catchup, Command, CommandId, Counts, Join, LaufId, LaufIn, Reason, Status, Verdict};
use support::{abholen, austeilen, gid, key, mark, marks, op, square, who, world::World, T0};

/// A world in which every kind of command has something to do.
fn busy() -> World {
    let mut w = World::standard();
    let (admin, member) = (who::admin(), who::member("nord"));
    w.ok(&admin, austeilen("n2", Some("nord"), square(13.0, 51.01, 0.005)));
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    let batch: Vec<_> = (0..12).map(|i| mark(&format!("h:{i}"), Status::Completed, op(T0 + i, "a"))).collect();
    w.ok(&member, marks("n1", batch));
    w.ok(&who::lead("nord"), Body::RunStart { run: LaufIn { id: LaufId::new("l1"), gebiet: gid("n1"), persons: 2, join: Join::Team } });
    w
}

fn commands() -> Vec<(&'static str, Body)> {
    let batch: Vec<_> = (0..12).map(|i| mark(&format!("h:{i}"), Status::Later, op(T0 + 1000 + i, "a"))).chain([mark("s:9", Status::Completed, op(T0 + 5, "a"))]).collect();
    vec![
        ("marks", marks("n1", batch)),
        ("gruppe", support::gruppe_in("west", "West")),
        ("gebiet", austeilen("n3", Some("nord"), square(13.0, 51.02, 0.005))),
        ("move", Body::Move { from: gid("n1"), to: gid("n2"), keys: vec![key("h:1"), key("h:2"), key("h:3")] }),
        ("cleanup", Body::Cleanup { gebiet: gid("n1"), keys: Some(vec![key("h:1"), key("h:2")]), expect: Counts { marks: 2, notes: 0 } }),
        ("run-end", Body::RunEnd { id: LaufId::new("l1") }),
        ("collect", Body::Collect { gebiet: gid("main") }),
        ("remove", Body::GebietRemove { id: gid("n2"), base_rev: 1 }),
    ]
}

#[test]
fn a_command_whose_storage_dies_halfway_changes_nothing_and_can_be_sent_again() {
    let admin = who::admin();
    for (name, body) in commands() {
        let mut w = busy();
        let before = w.a.dump().unwrap();
        let head = w.a.head();
        let command = Command { cid: CommandId::new("the-one"), body };
        let mut dying = 0;
        let mut budget = 0;
        loop {
            w.a.storage_mut().fail_after(Some(budget));
            let handled = w.a.handle(&admin, command.clone(), w.now);
            w.a.storage_mut().fail_after(None);
            w.assert_sound();
            match handled.reply.verdict {
                Verdict::Rejected { reason: Reason::Storage } => {
                    dying += 1;
                    assert!(handled.broadcast.is_empty(), "{name}: nothing is announced that did not happen");
                    assert_eq!(w.a.head(), head, "{name}: the head did not move (budget {budget})");
                    assert_eq!(w.a.dump().unwrap(), before, "{name}: the tables are as they were (budget {budget})");
                    budget += 1;
                    assert!(budget < 5000, "{name}: never succeeds");
                }
                Verdict::Accepted { .. } => {
                    assert!(!handled.replayed, "{name}: the dead attempts left no answer behind");
                    assert!(handled.head > head, "{name}: it happened");
                    break;
                }
                other => panic!("{name}: {other:?}"),
            }
        }
        assert!(dying > 3, "{name}: the command was cut at {dying} places");
        let again = w.a.handle(&admin, command, w.now);
        assert!(again.replayed, "{name}: now the answer is kept");
        w.assert_replays();
    }
}

#[test]
fn a_reader_whose_storage_dies_gets_a_storage_reason_and_nothing_else() {
    let mut w = busy();
    let admin = who::admin();
    w.a.storage_mut().fail_after(Some(0));
    assert_eq!(w.a.snapshot(&admin, w.now).unwrap_err(), Reason::Storage);
    assert_eq!(w.a.marks_page(&admin, w.now, None, 10).unwrap_err(), Reason::Storage);
    assert_eq!(w.a.catchup(&admin, w.now, 0, 10).unwrap_err(), Reason::Storage);
    w.a.storage_mut().fail_after(None);
    assert!(w.a.snapshot(&admin, w.now).is_ok());
}

#[test]
fn an_aktion_that_is_opened_again_is_the_one_that_was_closed() {
    let mut w = busy();
    let admin = who::admin();
    w.ok(&admin, Body::GebietRemove { id: gid("n2"), base_rev: 1 });
    // two clean-ups at the same server time are stamped apart, also across a reopening
    let clean = |keys: &[&str], n| Body::Cleanup { gebiet: gid("n1"), keys: Some(keys.iter().map(|k| key(k)).collect()), expect: Counts { marks: n, notes: 0 } };
    w.ok(&admin, clean(&["h:1"], 1));
    let dump = w.a.dump().unwrap();
    let (head, now) = (w.a.head(), w.now);
    let first_stamp = match &w.log().last().unwrap().change {
        flyermap_protocol::Change::MarksRemoved { rev, .. } => rev.clone(),
        other => panic!("{other:?}"),
    };
    let sql = std::mem::replace(&mut w.a, Aktion::open(RusqliteSql::memory().unwrap(), who::org(), who::aktion(), Limits::default()).unwrap()).into_sql();
    let mut reopened = Aktion::open(sql, who::org(), who::aktion(), Limits::default()).unwrap();
    assert_eq!((reopened.head(), reopened.floor(), reopened.dump().unwrap()), (head, 0, dump));
    reopened.handle(&admin, Command { cid: CommandId::new("again"), body: clean(&["h:2"], 1) }, now);
    let second_stamp = match &reopened.entries(head, 10).unwrap()[0].change {
        flyermap_protocol::Change::MarksRemoved { rev, .. } => rev.clone(),
        other => panic!("{other:?}"),
    };
    assert!(second_stamp > first_stamp, "the Akteur's clock goes on where it was");
    // the answers kept for retries survive as well
    let retry = reopened.handle(&admin, Command { cid: CommandId::new("again"), body: clean(&["h:2"], 1) }, now);
    assert!(retry.replayed);
    assert!(reopened.check().unwrap().is_empty());
}

fn closed() -> RusqliteSql {
    busy().a.into_sql()
}

#[test]
fn storage_of_another_aktion_or_layout_is_not_taken_over() {
    let other_aktion = flyermap_identity::AktionId::new("a-other");
    assert!(matches!(Aktion::open(closed(), who::org(), other_aktion, Limits::default()), Err(OpenError::Foreign)));
    let other_org = flyermap_identity::OrgId::new("org-other");
    assert!(matches!(Aktion::open(closed(), other_org, who::aktion(), Limits::default()), Err(OpenError::Foreign)));
    let mut sql = closed();
    sql.execute("UPDATE meta SET v = '99' WHERE k = 'schema'", &[]).unwrap();
    assert!(matches!(Aktion::open(sql, who::org(), who::aktion(), Limits::default()), Err(OpenError::Version)));
    assert!(Aktion::open(closed(), who::org(), who::aktion(), Limits::default()).is_ok());
}

#[test]
fn the_log_is_compacted_and_a_device_behind_the_floor_is_sent_for_a_snapshot() {
    let mut w = World::with(Limits { log_keep: 5, ..Limits::default() });
    let admin = who::admin();
    w.ok(&admin, support::gruppe_in("nord", "nord"));
    w.ok(&admin, austeilen("n1", Some("nord"), square(13.0, 51.0, 0.005)));
    for i in 0..10 {
        w.ok(&admin, marks("n1", vec![mark(&format!("h:{i}"), Status::Completed, op(T0 + i, "a"))]));
    }
    let head = w.a.head();
    assert_eq!(head, 12);
    assert_eq!(w.a.compact().unwrap(), head - 5);
    assert_eq!((w.a.floor(), w.a.head()), (7, 12));
    w.assert_sound();
    assert_eq!(w.log().iter().map(|e| e.seq).collect::<Vec<_>>(), [8, 9, 10, 11, 12]);
    // at the floor: fine. behind it, or ahead of the head: a snapshot
    let Catchup::Entries { entries, next, more, .. } = w.a.catchup(&admin, w.now, 7, 100).unwrap() else { panic!("expected entries") };
    assert_eq!((entries.len(), next, more), (5, 12, false));
    assert_eq!(w.a.catchup(&admin, w.now, 6, 100).unwrap(), Catchup::Resync { head: 12, floor: 7 });
    assert_eq!(w.a.catchup(&admin, w.now, 13, 100).unwrap(), Catchup::Resync { head: 12, floor: 7 });
    let Catchup::Entries { entries, more, .. } = w.a.catchup(&admin, w.now, 12, 100).unwrap() else { panic!("expected entries") };
    assert!(entries.is_empty() && !more);
    // nothing to compact twice; the state itself is untouched and the numbers go on
    assert_eq!(w.a.compact().unwrap(), 7);
    assert_eq!(w.a.snapshot(&admin, w.now).unwrap().floor, 7);
    assert_eq!(w.a.marks_page(&admin, w.now, None, 100).unwrap().marks.len(), 10);
    let handled = w.send(&admin, marks("n1", vec![mark("h:99", Status::Completed, op(T0 + 99, "a"))]));
    assert_eq!(handled.broadcast[0].seq, 13);
    // a log with a hole in front cannot be replayed
    let mut fresh = Aktion::open(RusqliteSql::memory().unwrap(), who::org(), who::aktion(), Limits::default()).unwrap();
    let entries = w.log();
    assert!(matches!(fresh.replay(&entries, w.now), Err(ReplayError::Gap { expected: 1, found: 8 })));
    assert_eq!(fresh.head(), 0);
    assert!(fresh.dump().unwrap().marks.is_empty(), "all or nothing");
    // log_keep 0 still keeps the newest entry, which is the head
    let mut tiny = World::with(Limits { log_keep: 0, ..Limits::default() });
    tiny.ok(&admin, support::gruppe_in("nord", "nord"));
    tiny.ok(&admin, support::gruppe_in("sued", "sued"));
    assert_eq!(tiny.a.compact().unwrap(), 1);
    assert_eq!(tiny.a.head(), 2);
    tiny.assert_sound();
}

#[test]
fn replaying_the_log_makes_the_same_state_in_any_prefix_and_keeps_the_numbers_going() {
    let mut w = busy();
    let admin = who::admin();
    w.ok(&admin, Body::Cleanup { gebiet: gid("n1"), keys: Some(vec![key("h:1")]), expect: Counts { marks: 1, notes: 0 } });
    w.ok(&admin, Body::GebietRemove { id: gid("n2"), base_rev: 1 });
    w.assert_replays();
    // the replayed Aktion goes on as if it had been the original: its clock is not behind the stamps in the log
    let entries = w.log();
    let mut fresh = Aktion::open(RusqliteSql::memory().unwrap(), who::org(), who::aktion(), Limits::default()).unwrap();
    let (first, rest) = entries.split_at(entries.len() / 2);
    fresh.replay(first, w.now).unwrap();
    assert!(fresh.check().unwrap().is_empty());
    fresh.replay(rest, w.now).unwrap();
    assert_eq!(fresh.dump().unwrap(), w.a.dump().unwrap());
    // an edit older than the clean-up still loses against it
    let handled = fresh.handle(&admin, Command { cid: CommandId::new("late"), body: marks("n1", vec![mark("h:1", Status::Completed, op(T0, "old"))]) }, w.now);
    assert!(matches!(handled.reply.verdict, Verdict::Accepted { applied: 0, stale: 1, .. }), "{:?}", handled.reply.verdict);
}
