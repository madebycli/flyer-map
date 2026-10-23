//! What a device reads: the snapshot, the pages and the log from a position, each cut to what the caller may see.
mod support;
use flyermap_aktion::Caller;
use flyermap_protocol::{limits::MAX_PAGE_ROWS, Body, Catchup, MarkCursor, NoteCursor, NoteId, NoteIn, Status};
use support::{
    abholen, austeilen, gid, gruppe_in, key, mark, marks,
    mirror::{oracle, Mirror},
    op, square, who,
    world::World,
    T0,
};

/// Three Gruppen with a Gebiet each, an Abholen main area with a part, and lots of marks, notes and a Lauf.
fn town(marks_per_gebiet: u64) -> World {
    let mut w = World::new();
    let admin = who::admin();
    for (g, x) in [("nord", 13.00), ("sued", 13.01), ("west", 13.02)] {
        w.ok(&admin, gruppe_in(g, g));
        w.ok(&admin, austeilen(&format!("{}1", &g[..1]), Some(g), square(x, 51.0, 0.005)));
    }
    w.ok(&admin, abholen("main", None, square(13.1, 51.0, 0.01)));
    w.ok(&admin, abholen("part", Some("main"), square(13.1, 51.0, 0.005)));
    for gebiet in ["n1", "s1", "w1", "part"] {
        let batch: Vec<_> = (0..marks_per_gebiet).map(|i| mark(&format!("h:{gebiet}-{i:04}"), Status::Completed, op(T0 + i, "a"))).collect();
        for chunk in batch.chunks(500) {
            w.ok(&admin, marks(gebiet, chunk.to_vec()));
        }
        let note = NoteIn {
            id: NoteId::new(format!("note-{gebiet}")),
            key: key(&format!("a:{gebiet}")),
            gebiet: gid(gebiet),
            flag: None,
            text: gebiet.into(),
            rev: op(T0, "a"),
            deleted: false,
        };
        w.ok(&admin, Body::Note { note });
    }
    w.ok(
        &admin,
        Body::RunStart {
            run: flyermap_protocol::LaufIn { id: flyermap_protocol::LaufId::new("l1"), gebiet: gid("s1"), persons: 1, join: flyermap_protocol::Join::Team },
        },
    );
    w
}

fn all_marks(w: &mut World, who: &Caller, page: u32) -> Vec<(String, String)> {
    let (mut out, mut after) = (Vec::new(), None::<MarkCursor>);
    loop {
        let got = w.a.marks_page(who, w.now, after.as_ref(), page).unwrap();
        assert!(got.marks.len() <= page.clamp(1, MAX_PAGE_ROWS) as usize);
        out.extend(got.marks.into_iter().map(|m| (m.gebiet.to_string(), m.key.to_string())));
        match got.next {
            Some(next) => after = Some(next),
            None => return out,
        }
    }
}

#[test]
fn the_snapshot_holds_what_the_caller_may_see_of_gruppen_gebiete_and_laeufe() {
    let mut w = town(2);
    let ids = |s: &flyermap_protocol::Snapshot| s.gebiete.iter().map(|g| g.id.to_string()).collect::<Vec<_>>();
    let admin = w.a.snapshot(&who::admin(), w.now).unwrap();
    assert_eq!((admin.head, admin.floor, admin.server_now), (w.a.head(), 0, w.now));
    assert_eq!(admin.gruppen.len(), 3);
    assert_eq!(ids(&admin), ["main", "n1", "part", "s1", "w1"]);
    assert_eq!(admin.laeufe.len(), 1);
    // a Member knows the outlines of the Austeilen world, the Läufe of its own Gruppe only, and nothing of Abholen
    let member = w.a.snapshot(&who::member("nord"), w.now).unwrap();
    assert_eq!((ids(&member), member.gruppen.len(), member.laeufe.len()), (vec!["n1".into(), "s1".into(), "w1".into()], 3, 0));
    assert_eq!(w.a.snapshot(&who::member("sued"), w.now).unwrap().laeufe.len(), 1);
    // a Helper knows the other world
    let helper = w.a.snapshot(&who::helper("h"), w.now).unwrap();
    assert_eq!((ids(&helper), helper.laeufe.len()), (vec!["main".into(), "part".into()], 0));
    assert_eq!(ids(&w.a.snapshot(&who::viewer(), w.now).unwrap()), ids(&admin));
    // a Lauf that ended long ago is no longer in the snapshot
    w.ok(&who::admin(), Body::RunEnd { id: flyermap_protocol::LaufId::new("l1") });
    assert_eq!(w.a.snapshot(&who::admin(), w.now).unwrap().laeufe.len(), 1);
    w.tick(48 * 60 * 60 * 1000 + 1);
    assert!(w.a.snapshot(&who::admin(), w.now).unwrap().laeufe.is_empty());
}

#[test]
fn pages_go_by_gebiet_and_key_and_every_page_size_gives_the_same_list() {
    let mut w = town(40);
    let admin = who::admin();
    let whole = all_marks(&mut w, &admin, 1000);
    assert_eq!(whole.len(), 160);
    let mut sorted = whole.clone();
    sorted.sort();
    assert_eq!(whole, sorted, "ordered by Gebiet, then key");
    for page in [1, 7, 40, 41, 159, 160, 161, 0, 5_000_000] {
        assert_eq!(all_marks(&mut w, &admin, page), whole, "page size {page}");
    }
    // exactly full: the last page says that it is the last
    let full = w.a.marks_page(&admin, w.now, None, 160).unwrap();
    assert_eq!((full.marks.len(), full.next), (160, None));
    // each caller gets its own cut, through the same pages
    let member = all_marks(&mut w, &who::member("nord"), 13);
    assert_eq!(member.len(), 40);
    assert!(member.iter().all(|(g, _)| g == "n1"));
    let helper = all_marks(&mut w, &who::helper("h"), 13);
    assert!(helper.iter().all(|(g, _)| g == "part") && helper.len() == 40);
    assert!(all_marks(&mut w, &who::member("ghost"), 13).is_empty());
    // a cursor that points into a Gebiet the caller cannot read goes on with the next one it can
    let cursor = MarkCursor { gebiet: gid("m"), key: key("h:zzz") };
    let got = w.a.marks_page(&who::member("nord"), w.now, Some(&cursor), 5).unwrap();
    assert!(got.marks.iter().all(|m| m.gebiet == gid("n1")) && got.marks.len() == 5 && got.marks[0].key.as_str() == "h:n1-0000");
    let past = MarkCursor { gebiet: gid("zzz"), key: key("h:") };
    assert!(w.a.marks_page(&admin, w.now, Some(&past), 5).unwrap().marks.is_empty());
}

#[test]
fn note_pages_follow_the_same_rules() {
    let mut w = town(1);
    let admin = who::admin();
    let (mut seen, mut after) = (Vec::new(), None::<NoteCursor>);
    loop {
        let got = w.a.notes_page(&admin, w.now, after.as_ref(), 2).unwrap();
        seen.extend(got.notes.into_iter().map(|n| n.id.to_string()));
        match got.next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    assert_eq!(seen, ["note-n1", "note-part", "note-s1", "note-w1"].map(String::from), "ordered by Gebiet, then id");
    let member = w.a.notes_page(&who::member("sued"), w.now, None, 10).unwrap();
    assert_eq!(member.notes.iter().map(|n| n.id.to_string()).collect::<Vec<_>>(), ["note-s1"]);
}

#[test]
fn catching_up_goes_in_pages_and_moves_on_over_what_the_caller_may_not_see() {
    let mut w = town(30);
    let (admin, member) = (who::admin(), who::member("nord"));
    let head = w.a.head();
    // the admin sees the whole log
    let Catchup::Entries { entries, next, head: h, more } = w.a.catchup(&admin, w.now, 0, 5).unwrap() else { panic!("expected entries") };
    assert_eq!((entries.len(), next, h, more), (5, 5, head, true));
    let mut seqs = Vec::new();
    let mut since = 0;
    loop {
        let Catchup::Entries { entries, next, more, .. } = w.a.catchup(&admin, w.now, since, 17).unwrap() else { panic!("expected entries") };
        seqs.extend(entries.iter().map(|e| e.seq));
        since = next;
        if !more {
            break;
        }
    }
    assert_eq!(seqs, (1..=head).collect::<Vec<_>>());
    // the Member sees a part of it, in the same order; the cursor moves over the rest
    let (mut shown, mut since, mut calls) = (Vec::new(), 0, 0);
    loop {
        let Catchup::Entries { entries, next, more, .. } = w.a.catchup(&member, w.now, since, 4).unwrap() else { panic!("expected entries") };
        assert!(next > since, "every call gets further");
        shown.extend(entries);
        since = next;
        calls += 1;
        if !more {
            break;
        }
    }
    assert!(calls > 1 && since == head);
    // a Member of nord: Gruppen, the outlines of the Austeilen world, and marks, notes and Läufe of n1 only
    let may_see = |e: &flyermap_protocol::Entry| match (&e.change, e.change.gebiet()) {
        (_, None) => true,
        (flyermap_protocol::Change::GebietSet { .. } | flyermap_protocol::Change::GebietRemoved { .. }, Some(g)) => !["main", "part"].contains(&g.as_str()),
        (_, Some(g)) => g.as_str() == "n1",
    };
    let expected: Vec<u64> = w.log().iter().filter(|e| may_see(e)).map(|e| e.seq).collect();
    assert_eq!(shown.iter().map(|e| e.seq).collect::<Vec<_>>(), expected);
    assert!(expected.len() < head as usize / 2, "the Member is spared most of the log");
    // nothing new
    let Catchup::Entries { entries, next, more, .. } = w.a.catchup(&member, w.now, head, 4).unwrap() else { panic!("expected entries") };
    assert!(entries.is_empty() && next == head && !more);
}

#[test]
fn a_device_built_from_snapshot_pages_and_log_sees_exactly_what_the_rights_allow() {
    let mut w = town(25);
    let admin = who::admin();
    // the state moves while pages are being read: some marks change, a note is deleted, a Gebiet is removed
    w.ok(&admin, marks("n1", vec![mark("h:n1-0003", Status::Later, op(T0 + 9000, "b"))]));
    w.ok(
        &admin,
        Body::Note {
            note: NoteIn {
                id: NoteId::new("note-s1"),
                key: key("a:s1"),
                gebiet: gid("s1"),
                flag: None,
                text: String::new(),
                rev: op(T0 + 9000, "b"),
                deleted: true,
            },
        },
    );
    w.ok(&admin, Body::RunEnd { id: flyermap_protocol::LaufId::new("l1") });
    w.ok(&admin, Body::GebietRemove { id: gid("w1"), base_rev: 1 });
    let dump = w.a.dump().unwrap();
    let callers = [
        who::admin(),
        who::owner(),
        who::member("nord"),
        who::member("west"),
        who::lead("sued"),
        who::helper("h"),
        who::helper_at("h2", "part"),
        who::viewer(),
    ];
    for caller in &callers {
        for page in [3, 1000] {
            let device = Mirror::from_scratch(&mut w.a, caller, w.now, page);
            assert_eq!(device.view(), oracle(&dump, caller, w.now), "{} with pages of {page}", caller.principal);
        }
    }
}

#[test]
fn marks_handed_to_a_gebiet_a_reader_cannot_read_leave_its_view() {
    let mut w = town(6);
    let admin = who::admin();
    let (nord, sued) = (who::member("nord"), who::member("sued"));
    let (mut nord_device, mut sued_device) = (Mirror::from_scratch(&mut w.a, &nord, w.now, 100), Mirror::from_scratch(&mut w.a, &sued, w.now, 100));
    assert_eq!((nord_device.view().marks.len(), sued_device.view().marks.len()), (6, 6));
    // two marks and the note on the whole Gebiet move from n1 (nord's) to s1 (sued's)
    let keys = vec![key("h:n1-0001"), key("h:n1-0002")];
    let handed = w.send(&admin, Body::Move { from: gid("n1"), to: gid("s1"), keys: keys.clone() });
    assert!(handed.reply.verdict.is_accepted());
    let kinds: Vec<_> = handed.broadcast.iter().map(|e| e.change.kind()).collect();
    assert_eq!(kinds, ["mark-set", "mark-set", "handed-over", "lauf-set"], "the Lauf that runs in s1 counts again");
    for (caller, device) in [(&nord, &mut nord_device), (&sued, &mut sued_device)] {
        let shown = handed.audience.filter(caller, w.now, &handed.broadcast);
        device.apply_all(&shown);
        device.advance(handed.head);
    }
    // each is told what concerns it: nord that the marks left, sued that they came
    assert_eq!((nord_device.view().marks.len(), sued_device.view().marks.len()), (4, 8));
    let dump = w.a.dump().unwrap();
    assert_eq!(nord_device.view(), oracle(&dump, &nord, w.now));
    assert_eq!(sued_device.view(), oracle(&dump, &sued, w.now));
    assert_eq!(Mirror::from_scratch(&mut w.a, &nord, w.now, 5).view(), nord_device.view());
}

#[test]
fn a_device_that_listens_while_things_happen_ends_where_one_built_from_scratch_ends() {
    let mut w = town(5);
    let callers = [who::admin(), who::member("nord"), who::lead("sued"), who::helper("h"), who::viewer()];
    let mut devices: Vec<Mirror> = callers.iter().map(|c| Mirror::from_scratch(&mut w.a, c, w.now, 100)).collect();
    let admin = who::admin();
    let clean = Body::Cleanup { gebiet: gid("s1"), keys: Some(vec![key("h:s1-0001")]), expect: flyermap_protocol::Counts { marks: 1, notes: 0 } };
    let sent = vec![
        w.send(&admin, marks("n1", vec![mark("h:new", Status::Completed, op(T0 + 50, "b"))])),
        w.send(&admin, marks("part", vec![mark("h:new", Status::Completed, op(T0 + 50, "b"))])),
        w.send(&admin, clean),
        w.send(&admin, Body::RunEnd { id: flyermap_protocol::LaufId::new("l1") }),
        w.send(&admin, Body::GebietRemove { id: gid("part"), base_rev: 1 }),
    ];
    for handled in &sent {
        for (caller, device) in callers.iter().zip(devices.iter_mut()) {
            device.apply_all(&handled.audience.filter(caller, w.now, &handled.broadcast));
        }
    }
    let dump = w.a.dump().unwrap();
    for (caller, device) in callers.iter().zip(&devices) {
        assert_eq!(device.view(), oracle(&dump, caller, w.now), "{} listening", caller.principal);
        assert_eq!(device.view(), Mirror::from_scratch(&mut w.a, caller, w.now, 7).view(), "{} from scratch", caller.principal);
    }
}
