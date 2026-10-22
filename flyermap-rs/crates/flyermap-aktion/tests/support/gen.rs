//! Random commands for the property tests: plausible ones (most of them are meant to succeed or fail for a reason) from a small cast, over a small set
//! of ids so that they keep meeting each other. Deterministic by seed.
use super::{austeilen, gid, gr, key, mark, op, square, who};
use flyermap_aktion::{Caller, Dump};
use flyermap_protocol::{
    Art, Body, Counts, GebietIn, GruppeIn, Join, LaufId, LaufIn, NoteId, NoteIn, Status,
};

pub struct Rng(pub u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    pub fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

pub const GEBIETE: [&str; 8] = ["n1", "n2", "s1", "n3", "main", "p1", "p2", "p3"];
pub const GRUPPEN: [&str; 3] = ["nord", "sued", "west"];

/// The cast, with how often each acts (percent).
pub fn cast() -> Vec<(u64, Caller)> {
    vec![
        (30, who::admin()),
        (15, who::lead("nord")),
        (15, who::member("nord")),
        (10, who::member("sued")),
        (10, who::helper("h1")),
        (5, who::helper_at("h2", "p1")),
        (5, who::viewer()),
        (5, who::stranger()),
        (5, who::nobody()),
    ]
}

pub fn pick_caller<'a>(rng: &mut Rng, cast: &'a [(u64, Caller)]) -> &'a Caller {
    let mut roll = rng.below(100);
    for (weight, caller) in cast {
        if roll < *weight {
            return caller;
        }
        roll -= weight;
    }
    &cast[0].1
}

fn art_of(id: &str) -> Art {
    if id == "main" || id.starts_with('p') {
        Art::Abholen
    } else {
        Art::Austeilen
    }
}

fn parent_of(id: &str) -> Option<&'static str> {
    id.starts_with('p').then_some("main")
}

fn base_ring(id: &str, rng: &mut Rng) -> Vec<[f64; 2]> {
    let (x, y, size) = match id {
        "n1" => (13.00, 51.00, 0.005),
        "n2" => (13.00, 51.01, 0.005),
        "s1" => (13.01, 51.00, 0.005),
        "n3" => (13.02, 51.00, 0.005),
        "main" => (13.10, 51.00, 0.02),
        "p1" => (13.10, 51.00, 0.01),
        "p2" => (13.11, 51.00, 0.01),
        _ => (13.10, 51.01, 0.005),
    };
    let scale = *rng.pick(&[1.0, 1.0, 1.0, 0.8, 1.5]);
    square(x, y, size * scale)
}

fn rev_guess(rng: &mut Rng, truth: Option<u64>) -> u64 {
    match truth {
        Some(rev) if rng.chance(85) => rev,
        _ => rng.below(4),
    }
}

fn gebiet_rev(dump: &Dump, id: &str) -> Option<u64> {
    dump.gebiete.iter().find(|(g, _)| g.id.as_str() == id).map(|(g, _)| g.rev)
}

fn some_keys(rng: &mut Rng) -> Vec<flyermap_protocol::Key> {
    (0..1 + rng.below(3)).map(|_| key(&format!("{}:{}", if rng.chance(80) { "h" } else { "s" }, 1 + rng.below(10)))).collect()
}

/// One random command. `now` is the server's time; `dump` is the state it will meet (the generator reads revisions and counts from it, as an app would).
pub fn command(rng: &mut Rng, now: u64, dump: &Dump) -> Body {
    let gebiet = *rng.pick(&GEBIETE);
    match rng.below(100) {
        0..=34 => {
            let target = if rng.chance(4) { "ghost" } else { gebiet };
            let list = (0..1 + rng.below(4))
                .map(|_| {
                    let wall = if rng.chance(3) { now + 3_600_000 } else { (now + rng.below(6000)).saturating_sub(3000) };
                    let node = *rng.pick(&["a", "b", "c"]);
                    let kind = if rng.chance(80) { "h" } else { "s" };
                    mark(&format!("{kind}:{}", 1 + rng.below(12)), *rng.pick(&Status::ALL), op(wall, node))
                })
                .collect();
            super::marks(target, list)
        }
        35..=44 => {
            let id = format!("note-{}", 1 + rng.below(6));
            let k = if rng.chance(70) { format!("h:{}", 1 + rng.below(12)) } else { format!("a:{}", if rng.chance(90) { gebiet } else { "n1" }) };
            let wall = (now + rng.below(6000)).saturating_sub(3000);
            let text = if rng.chance(10) { String::new() } else { format!("text {}", rng.below(100)) };
            Body::Note { note: NoteIn { id: NoteId::new(id), key: key(&k), gebiet: gid(gebiet), flag: None, text, rev: op(wall, "n"), deleted: rng.chance(20) } }
        }
        45..=52 => {
            let id = *rng.pick(&GRUPPEN);
            let truth = dump.gruppen.iter().find(|(g, _)| g.id.as_str() == id).map(|(g, _)| g.rev);
            Body::Gruppe { gruppe: GruppeIn { id: gr(id), name: format!("Gruppe {}", rng.below(5)), color: rng.below(33) as u8, base_rev: if rng.chance(50) { 0 } else { rev_guess(rng, truth) } } }
        }
        53..=54 => {
            let id = *rng.pick(&GRUPPEN);
            let truth = dump.gruppen.iter().find(|(g, _)| g.id.as_str() == id).map(|(g, _)| g.rev);
            Body::GruppeRemove { id: gr(id), base_rev: rev_guess(rng, truth) }
        }
        55..=70 => {
            let existing = dump.gebiete.iter().find(|(g, _)| g.id.as_str() == gebiet);
            let art = if rng.chance(97) { art_of(gebiet) } else { Art::Abholen };
            // an existing Gebiet keeps its Gruppe: giving a Gebiet to another Gruppe takes visibility away, which this test's devices are not told of
            let gruppe = match existing {
                Some((g, _)) => g.gruppe.as_ref().map(|g| g.as_str().to_string()),
                None if art == Art::Austeilen => rng.pick(&[Some("nord"), Some("nord"), Some("sued"), None, Some("west")]).map(String::from),
                None => None,
            };
            let base_rev = if existing.is_none() && rng.chance(90) { 0 } else { rev_guess(rng, gebiet_rev(dump, gebiet)) };
            let parent = parent_of(gebiet).map(gid);
            let ring = base_ring(gebiet, rng);
            Body::Gebiet { gebiet: GebietIn { id: gid(gebiet), art, gruppe: gruppe.as_deref().map(gr), parent, name: format!("Gebiet {gebiet}"), ring, base_rev } }
        }
        71..=74 => Body::GebietRemove { id: gid(gebiet), base_rev: rev_guess(rng, gebiet_rev(dump, gebiet)) },
        75..=79 => Body::Collect { gebiet: gid(gebiet) },
        80..=82 => Body::Release { gebiet: gid(gebiet) },
        83..=87 => Body::RunStart { run: LaufIn { id: LaufId::new(format!("l{}", 1 + rng.below(4))), gebiet: gid(gebiet), persons: rng.below(6) as u16, join: *rng.pick(&[Join::Closed, Join::Team, Join::Link]) } },
        88..=89 => Body::RunUpdate { id: LaufId::new(format!("l{}", 1 + rng.below(4))), persons: rng.chance(60).then(|| rng.below(9) as u16), join: rng.chance(40).then_some(Join::Link) },
        90..=91 => Body::RunEnd { id: LaufId::new(format!("l{}", 1 + rng.below(4))) },
        92..=95 => {
            let deleted = dump.gebiete.iter().find(|(g, _)| g.id.as_str() == gebiet).is_some_and(|(_, d)| *d);
            if deleted && rng.chance(60) {
                let marks = dump.marks.iter().filter(|(m, removed)| !removed && m.gebiet.as_str() == gebiet).count() as u32;
                let notes = dump.notes.iter().filter(|n| !n.deleted && n.gebiet.as_str() == gebiet).count() as u32;
                Body::Cleanup { gebiet: gid(gebiet), keys: None, expect: Counts { marks, notes } }
            } else {
                let keys = some_keys(rng);
                let marks = dump.marks.iter().filter(|(m, removed)| !removed && m.gebiet.as_str() == gebiet && keys.contains(&m.key)).count() as u32;
                let notes = dump.notes.iter().filter(|n| !n.deleted && n.gebiet.as_str() == gebiet && keys.contains(&n.key)).count() as u32;
                let expect = if rng.chance(75) { Counts { marks, notes } } else { Counts { marks: marks + 1, notes } };
                Body::Cleanup { gebiet: gid(gebiet), keys: Some(keys), expect }
            }
        }
        _ => Body::Move { from: gid(gebiet), to: gid(*rng.pick(&GEBIETE)), keys: some_keys(rng) },
    }
}

/// A fresh Aktion's first steps, so that random commands have something to meet.
pub fn seed_commands() -> Vec<Body> {
    vec![
        super::gruppe_in("nord", "nord"),
        super::gruppe_in("sued", "sued"),
        austeilen("n1", Some("nord"), square(13.00, 51.00, 0.005)),
        austeilen("s1", Some("sued"), square(13.01, 51.00, 0.005)),
        super::abholen("main", None, square(13.10, 51.00, 0.02)),
        super::abholen("p1", Some("main"), square(13.10, 51.00, 0.01)),
    ]
}
