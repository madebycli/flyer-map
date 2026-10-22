//! Marks and notes: last writer wins by stamp, whatever the order and the number of deliveries; items are judged on their own; limits hold.
mod support;
use flyermap_aktion::Limits;
use flyermap_protocol::{limits::MAX_MARKS, Body, Command, CommandId, Flag, NoteId, NoteIn, Reason, Refused, Status, Verdict, Why};
use support::{abholen, gid, key, mark, marks, op, square, who, world::World, T0};

fn tally(verdict: &Verdict) -> (u32, u32, Vec<Refused>) {
    match verdict {
        Verdict::Accepted { applied, stale, refused, .. } => (*applied, *stale, refused.clone()),
        other => panic!("not accepted: {other:?}"),
    }
}

fn status_of(w: &mut World, who: &flyermap_aktion::Caller, gebiet: &str, key_text: &str) -> Option<(Status, String)> {
    let page = w.a.marks_page(who, w.now, None, 1000).unwrap();
    page.marks.into_iter().find(|m| m.gebiet.as_str() == gebiet && m.key.as_str() == key_text).map(|m| (m.status, m.op.to_string()))
}

#[test]
fn the_newest_stamp_wins_in_whatever_order_it_arrives() {
    let mut w = World::standard();
    let member = who::member("nord");
    let (old, mid, new) = (op(T0 - 3000, "a"), op(T0 - 2000, "b"), op(T0 - 1000, "c"));
    let (applied, stale, _) = tally(&w.ok(&member, marks("n1", vec![mark("h:1", Status::Later, mid.clone())])));
    assert_eq!((applied, stale), (1, 0));
    // an older edit from a phone that was offline loses and says so
    let (applied, stale, _) = tally(&w.ok(&member, marks("n1", vec![mark("h:1", Status::Completed, old)])));
    assert_eq!((applied, stale), (0, 1));
    assert_eq!(status_of(&mut w, &member, "n1", "h:1").unwrap().0, Status::Later);
    // the same stamp again is nothing new
    let (applied, stale, _) = tally(&w.ok(&member, marks("n1", vec![mark("h:1", Status::Later, mid)])));
    assert_eq!((applied, stale), (0, 1));
    let (applied, _, _) = tally(&w.ok(&member, marks("n1", vec![mark("h:1", Status::NotDeliverable, new.clone())])));
    assert_eq!(applied, 1);
    assert_eq!(status_of(&mut w, &member, "n1", "h:1"), Some((Status::NotDeliverable, new.to_string())));
    w.assert_replays();
}

#[test]
fn of_several_edits_to_one_key_in_a_batch_only_the_newest_happens() {
    let mut w = World::standard();
    let member = who::member("nord");
    let batch = vec![
        mark("h:1", Status::Completed, op(T0 - 100, "a")),
        mark("h:1", Status::Later, op(T0 - 300, "a")),
        mark("h:1", Status::Open, op(T0 - 200, "a")),
        mark("h:2", Status::Completed, op(T0 - 100, "a")),
    ];
    let handled = w.send(&member, marks("n1", batch));
    let (applied, stale, refused) = tally(&handled.reply.verdict);
    assert_eq!((applied, stale, refused.len()), (2, 2, 0));
    assert_eq!(handled.broadcast.len(), 2, "one entry per winner");
    assert_eq!(status_of(&mut w, &member, "n1", "h:1").unwrap().0, Status::Completed);
}

#[test]
fn an_item_that_is_wrong_is_refused_alone_and_named_by_its_position() {
    let mut w = World::standard();
    let member = who::member("nord");
    let future = op(T0 + Limits::default().future_skew_ms + 1, "a");
    let ancient = op(T0 - Limits::default().past_skew_ms - 1, "a");
    let batch = vec![
        mark("h:1", Status::Completed, op(T0, "a")),
        mark("x:1", Status::Completed, op(T0, "a")),
        mark("h:2", Status::Completed, flyermap_protocol::OpId::new("junk")),
        mark("h:3", Status::Completed, future),
        mark("h:4", Status::Completed, ancient),
        mark("s:5", Status::Later, op(T0, "a")),
        mark("h:", Status::Later, op(T0, "a")),
    ];
    let (applied, _, refused) = tally(&w.ok(&member, marks("n1", batch)));
    assert_eq!(applied, 2);
    let reasons: Vec<(u32, Reason)> = refused.into_iter().map(|r| (r.index, r.reason)).collect();
    assert_eq!(reasons, vec![(1, Reason::BadKey), (2, Reason::BadClock), (3, Reason::ClockSkew), (4, Reason::ClockSkew), (6, Reason::BadKey)]);
}

#[test]
fn a_batch_is_bounded_and_not_empty() {
    let mut w = World::standard();
    let member = who::member("nord");
    let many: Vec<_> = (0..=MAX_MARKS).map(|i| mark(&format!("h:{i}"), Status::Completed, op(T0, "a"))).collect();
    assert_eq!(w.no(&member, marks("n1", many)), Reason::TooLarge { limit: MAX_MARKS as u32 });
    assert_eq!(w.no(&member, marks("n1", Vec::new())), Reason::BadValue);
    let full: Vec<_> = (0..MAX_MARKS).map(|i| mark(&format!("h:{i}"), Status::Completed, op(T0, "a"))).collect();
    assert_eq!(tally(&w.ok(&member, marks("n1", full))).0, MAX_MARKS as u32);
}

#[test]
fn a_key_belongs_to_one_gebiet_and_a_gebiet_can_hold_only_so_many_rows() {
    let mut w = World::with(Limits { max_marks_per_gebiet: 3, ..Limits::default() });
    let admin = who::admin();
    w.ok(&admin, support::gruppe_in("nord", "nord"));
    w.ok(&admin, support::austeilen("n1", Some("nord"), square(13.0, 51.0, 0.005)));
    w.ok(&admin, support::austeilen("n2", Some("nord"), square(13.01, 51.0, 0.005)));
    let batch = |keys: &[&str]| marks("n1", keys.iter().map(|k| mark(k, Status::Completed, op(T0, "a"))).collect());
    w.ok(&admin, batch(&["h:1", "h:2", "h:3"]));
    assert_eq!(w.no(&admin, batch(&["h:4"])), Reason::LimitReached { limit: 3 });
    // editing what is there is not growing
    w.ok(&admin, marks("n1", vec![mark("h:1", Status::Later, op(T0 + 1, "a"))]));
    // a key that lives in n1 cannot be claimed by n2
    let (applied, _, refused) = tally(&w.ok(&admin, marks("n2", vec![mark("h:1", Status::Completed, op(T0 + 5, "a"))])));
    assert_eq!((applied, refused), (0, vec![Refused { index: 0, reason: Reason::KeyOwnedElsewhere }]));
}

#[test]
fn nothing_is_marked_in_a_gebiet_that_is_gone() {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(&admin, Body::GebietRemove { id: gid("n1"), base_rev: 1 });
    assert_eq!(w.no(&admin, marks("n1", vec![mark("h:1", Status::Completed, op(T0, "a"))])), Reason::Deleted);
    let note = note("x", "n1", "h:1", "text", op(T0, "a"));
    assert_eq!(w.no(&admin, Body::Note { note }), Reason::Deleted);
}

#[test]
fn the_same_command_twice_happens_once_and_a_different_one_under_the_same_id_is_refused() {
    let mut w = World::standard();
    let member = who::member("nord");
    let command = Command { cid: CommandId::new("once"), body: marks("n1", vec![mark("h:1", Status::Completed, op(T0, "a"))]) };
    let first = w.send_command(&member, command.clone());
    assert!(!first.replayed && first.broadcast.len() == 1);
    let head = w.a.head();
    let again = w.send_command(&member, command.clone());
    assert!(again.replayed);
    assert_eq!(again.reply, first.reply, "the answer of the first time");
    assert!(again.broadcast.is_empty());
    assert_eq!(w.a.head(), head);
    // the answer to a retry is the same also when the state has moved on
    w.ok(&member, marks("n1", vec![mark("h:1", Status::Later, op(T0 + 10, "a"))]));
    assert_eq!(w.send_command(&member, command.clone()).reply, first.reply);
    // another command under the id
    let other = Command { cid: CommandId::new("once"), body: marks("n1", vec![mark("h:2", Status::Completed, op(T0, "a"))]) };
    let head = w.a.head();
    let handled = w.send_command(&member, other.clone());
    assert_eq!(handled.reply.verdict, Verdict::rejected(Reason::CidReused));
    assert_eq!(w.a.head(), head);
    // ids belong to whoever sent them
    let admin = who::admin();
    let handled = w.send_command(&admin, other);
    assert!(handled.reply.verdict.is_accepted() && !handled.replayed);
}

#[test]
fn answers_kept_for_retries_are_forgotten_after_their_time() {
    let mut w = World::standard();
    let member = who::member("nord");
    w.ok(&member, marks("n1", vec![mark("h:1", Status::Completed, op(T0, "a"))]));
    let kept = w.a.answers_kept().unwrap();
    assert!(kept >= 3);
    w.tick(Limits::default().done_ttl_ms + 2 * 60 * 60 * 1000);
    w.ok(&member, marks("n1", vec![mark("h:1", Status::Later, op(w.now, "a"))]));
    assert_eq!(w.a.answers_kept().unwrap(), 1, "only the newest answer is left");
}

fn note(id: &str, gebiet: &str, key_text: &str, text: &str, rev: flyermap_protocol::OpId) -> NoteIn {
    NoteIn { id: NoteId::new(id), key: key(key_text), gebiet: gid(gebiet), flag: None, text: text.to_string(), rev, deleted: false }
}

fn notes_of(w: &mut World, who: &flyermap_aktion::Caller) -> Vec<(String, String)> {
    w.a.notes_page(who, w.now, None, 1000).unwrap().notes.into_iter().map(|n| (n.id.as_str().to_string(), n.text)).collect()
}

#[test]
fn a_note_is_written_changed_and_deleted_by_stamp_and_a_deleted_one_stays_deleted() {
    let mut w = World::standard();
    let member = who::member("nord");
    let (t1, t2, t3) = (op(T0 - 3000, "a"), op(T0 - 2000, "a"), op(T0 - 1000, "a"));
    w.ok(&member, Body::Note { note: note("n-1", "n1", "h:7", "  Hund  \u{7}", t2.clone()) });
    assert_eq!(notes_of(&mut w, &member), vec![("n-1".into(), "Hund".into())], "cleaned like on the device");
    // older: stale, nothing changes
    let (applied, stale, _) = tally(&w.ok(&member, Body::Note { note: note("n-1", "n1", "h:7", "alt", t1) }));
    assert_eq!((applied, stale), (0, 1));
    let flagged = NoteIn { flag: Some(Flag::Again), ..note("n-1", "n1", "h:7", "", t3.clone()) };
    w.ok(&member, Body::Note { note: flagged });
    let page = w.a.notes_page(&member, w.now, None, 10).unwrap();
    assert_eq!((page.notes[0].flag, page.notes[0].text.as_str()), (Some(Flag::Again), ""), "a flag alone is a note");
    // delete with a newer stamp; an edit older than the deletion does not bring it back
    let gone = NoteIn { deleted: true, ..note("n-1", "n1", "h:7", "ignored", op(T0 - 500, "a")) };
    w.ok(&member, Body::Note { note: gone });
    assert!(notes_of(&mut w, &member).is_empty());
    let (applied, stale, _) = tally(&w.ok(&member, Body::Note { note: note("n-1", "n1", "h:7", "zurück", t3) }));
    assert_eq!((applied, stale), (0, 1));
    assert!(notes_of(&mut w, &member).is_empty());
    // the tombstone keeps no content
    let dump = w.a.dump().unwrap();
    assert!(dump.notes.iter().all(|n| !n.deleted || (n.text.is_empty() && n.flag.is_none())));
    w.assert_replays();
}

#[test]
fn a_note_must_be_a_note_on_something_and_something_of_its_own_gebiet() {
    let mut w = World::standard();
    let admin = who::admin();
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    let send = |w: &mut World, n: NoteIn| w.send(&admin, Body::Note { note: n }).reply.verdict;
    let rejected = |v: Verdict| match v {
        Verdict::Rejected { reason } => reason,
        other => panic!("accepted: {other:?}"),
    };
    assert_eq!(rejected(send(&mut w, note("a", "n1", "x:1", "t", op(T0, "a")))), Reason::BadKey);
    assert_eq!(rejected(send(&mut w, note("a", "n1", "a:other", "t", op(T0, "a")))), Reason::BadKey, "a note on a Gebiet names that Gebiet");
    assert_eq!(rejected(send(&mut w, note("a", "n1", "h:1", "  \u{1}", op(T0, "a")))), Reason::BadText);
    assert_eq!(rejected(send(&mut w, note("a b", "n1", "h:1", "t", op(T0, "a")))), Reason::BadId);
    assert_eq!(rejected(send(&mut w, note("a", "n1", "h:1", "t", op(T0 + 99_999_999, "a")))), Reason::ClockSkew);
    assert!(send(&mut w, note("a", "n1", "a:n1", "ganzes Gebiet", op(T0, "a"))).is_accepted());
    // an id that is another note's: not hers to take over
    assert_eq!(rejected(send(&mut w, note("a", "n1", "h:2", "t", op(T0 + 1, "a")))), Reason::KeyOwnedElsewhere);
    assert_eq!(rejected(send(&mut w, note("a", "s1", "a:s1", "t", op(T0 + 1, "a")))), Reason::KeyOwnedElsewhere);
    // somebody who works in another Gruppe may not touch it
    let other = who::member("sued");
    assert_eq!(w.no(&other, Body::Note { note: note("a", "n1", "a:n1", "weg", op(T0 + 2, "a")) }), Reason::Forbidden { why: Why::OutOfScope });
    assert_eq!(notes_of(&mut w, &admin), vec![("a".to_string(), "ganzes Gebiet".to_string())]);
}

#[test]
fn a_gebiet_holds_only_so_many_notes() {
    let mut w = World::with(Limits { max_notes_per_gebiet: 2, ..Limits::default() });
    let admin = who::admin();
    w.ok(&admin, support::austeilen("n1", None, square(13.0, 51.0, 0.005)));
    for i in 0..2 {
        w.ok(&admin, Body::Note { note: note(&format!("n{i}"), "n1", "h:1", "t", op(T0, "a")) });
    }
    assert_eq!(w.no(&admin, Body::Note { note: note("n9", "n1", "h:1", "t", op(T0, "a")) }), Reason::LimitReached { limit: 2 });
    w.ok(&admin, Body::Note { note: note("n0", "n1", "h:1", "neuer", op(T0 + 1, "a")) });
}
