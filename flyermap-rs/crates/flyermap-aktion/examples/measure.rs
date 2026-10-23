//! What the Akteur costs on a whole-city Aktion: 51,000 houses marked in batches of 500, then everything a device reads. Native SQLite in memory, so
//! the numbers are the Akteur's own work and not the network's; run it with `cargo run --release -p flyermap-aktion --example measure`.
//! Numbers only, no data: nothing here is printed that names a place or a person.
use flyermap_aktion::{Aktion, Caller, Limits, RusqliteSql};
use flyermap_core::clock::{encode_clock, ClockState};
use flyermap_identity::{AccessSet, AktionId, Grant, OrgId, Role, Scope};
use flyermap_protocol::{Art, Body, Catchup, Command, CommandId, GebietId, GebietIn, GruppeId, GruppeIn, Join, Key, LaufId, LaufIn, MarkIn, Status};
use std::time::Instant;

const T0: u64 = 1_800_000_000_000;
const HOUSES: u64 = 51_000;

fn millis(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * p) as usize]
}

fn main() {
    let (org, aktion) = (OrgId::new("org"), AktionId::new("a1"));
    let sql = RusqliteSql::memory().expect("memory");
    let mut a = Aktion::open(sql, org.clone(), aktion.clone(), Limits { max_marks_per_gebiet: 1_000_000, ..Limits::default() }).expect("open");
    let admin = Caller::new("admin", AccessSet::new(vec![Grant::new(Role::Admin, Scope::Aktion { org, aktion })]));
    let mut now = T0;
    let mut cid = 0u64;
    let mut send = |a: &mut Aktion<RusqliteSql>, body: Body, now: u64| {
        cid += 1;
        let handled = a.handle(&admin, Command { cid: CommandId::new(format!("c{cid}")), body }, now);
        assert!(handled.reply.verdict.is_accepted(), "{:?}", handled.reply.verdict);
        handled
    };

    send(&mut a, Body::Gruppe { gruppe: GruppeIn { id: GruppeId::new("g"), name: "g".into(), color: 1, base_rev: 0 } }, now);
    let ring = vec![[13.0, 51.0], [13.1, 51.0], [13.1, 51.1], [13.0, 51.1], [13.0, 51.0]];
    send(
        &mut a,
        Body::Gebiet {
            gebiet: GebietIn {
                id: GebietId::new("big"),
                art: Art::Austeilen,
                gruppe: Some(GruppeId::new("g")),
                parent: None,
                name: "big".into(),
                ring,
                base_rev: 0,
            },
        },
        now,
    );
    send(&mut a, Body::RunStart { run: LaufIn { id: LaufId::new("l"), gebiet: GebietId::new("big"), persons: 4, join: Join::Team } }, now);

    // marking: 102 batches of 500 distinct houses, every one completed, with a Lauf running that has to be counted again each time
    let mut took = Vec::new();
    let all = Instant::now();
    for batch in 0..HOUSES / 500 {
        now += 2_000;
        let marks: Vec<MarkIn> = (0..500)
            .map(|i| {
                let n = batch * 500 + i;
                MarkIn {
                    key: Key::house(&format!("{n:06}")),
                    status: Status::Completed,
                    op: encode_clock(&ClockState { wall: now, counter: i as u32, node: "dev".into() }),
                }
            })
            .collect();
        let t = Instant::now();
        send(&mut a, Body::Marks { gebiet: GebietId::new("big"), marks }, now);
        took.push(millis(t));
    }
    let total = millis(all);
    took.sort_by(f64::total_cmp);
    println!("marking {HOUSES} houses in {} batches of 500: {total:.0} ms in all", took.len());
    println!("  per batch: median {:.1} ms, 99th {:.1} ms, worst {:.1} ms", percentile(&took, 0.5), percentile(&took, 0.99), took[took.len() - 1]);
    println!("  per house: {:.1} us", total * 1000.0 / HOUSES as f64);

    // one more batch of the same houses with newer stamps: every one is a change of a row that exists
    now += 2_000;
    let marks: Vec<MarkIn> = (0..500)
        .map(|i| MarkIn {
            key: Key::house(&format!("{i:06}")),
            status: Status::Later,
            op: encode_clock(&ClockState { wall: now, counter: i as u32, node: "dev".into() }),
        })
        .collect();
    let t = Instant::now();
    send(&mut a, Body::Marks { gebiet: GebietId::new("big"), marks }, now);
    println!("changing 500 existing marks: {:.1} ms", millis(t));

    // reading
    let t = Instant::now();
    let snapshot = a.snapshot(&admin, now).expect("snapshot");
    println!("snapshot: {:.2} ms ({} Gebiete, {} Läufe, head {})", millis(t), snapshot.gebiete.len(), snapshot.laeufe.len(), snapshot.head);
    let (t, mut pages, mut rows, mut after) = (Instant::now(), 0, 0, None);
    loop {
        let page = a.marks_page(&admin, now, after.as_ref(), 1000).expect("page");
        pages += 1;
        rows += page.marks.len();
        match page.next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    println!("all marks in pages of 1000: {:.0} ms ({pages} pages, {rows} marks)", millis(t));
    let (t, mut calls, mut entries, mut since) = (Instant::now(), 0, 0, 0);
    loop {
        match a.catchup(&admin, now, since, 1000).expect("catch up") {
            Catchup::Entries { entries: got, next, more, .. } => {
                calls += 1;
                entries += got.len();
                since = next;
                if !more {
                    break;
                }
            }
            Catchup::Resync { .. } => unreachable!(),
        }
    }
    println!("the whole log in pages of 1000: {:.0} ms ({calls} calls, {entries} entries)", millis(t));
    let t = Instant::now();
    let tail = a.catchup(&admin, now, a.head() - 10, 1000).expect("tail");
    println!("catching up on the last 10 entries: {:.2} ms ({})", millis(t), matches!(tail, Catchup::Entries { .. }));

    // keeping house
    let t = Instant::now();
    let dump = a.dump().expect("dump");
    println!("dump of the state: {:.0} ms ({} marks)", millis(t), dump.marks.len());
    let t = Instant::now();
    let faults = a.check().expect("check");
    println!("invariants check: {:.0} ms ({} faults)", millis(t), faults.len());
    let t = Instant::now();
    let floor = a.compact().expect("compact");
    println!("compaction to the newest {}: {:.0} ms (floor {floor})", Limits::default().log_keep, millis(t));
    let bytes = a.storage_mut().size_bytes().expect("size");
    println!(
        "storage: {:.1} MB for {HOUSES} marks and a log of {} entries ({:.0} bytes per mark)",
        bytes as f64 / 1e6,
        a.head() - floor,
        bytes as f64 / HOUSES as f64
    );
}
