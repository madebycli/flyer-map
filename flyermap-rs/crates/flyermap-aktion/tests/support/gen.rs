//! Random commands for the property tests: plausible ones (most of them are meant to succeed or fail for a reason) from a small cast, over a small set
//! of ids so that they keep meeting each other. Deterministic by seed.
use super::{austeilen, gid, gr, key, mark, op, square, who};
use flyermap_aktion::{Caller, Dump};
use flyermap_protocol::{Art, Body, Counts, GebietIn, GruppeIn, Join, Key, LaufId, LaufIn, NoteId, NoteIn, Status};

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
        (40, who::admin()),
        (15, who::lead("nord")),
        (15, who::member("nord")),
        (8, who::member("sued")),
        (10, who::helper("h1")),
        (5, who::helper_at("h2", "p1")),
        (3, who::viewer()),
        (2, who::stranger()),
        (2, who::nobody()),
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

/// A Gebiet to talk about: mostly one that is there (also a deleted one: its orphans are the point), sometimes any id of the pool.
fn pick_gebiet(rng: &mut Rng, dump: &Dump) -> String {
    if dump.gebiete.is_empty() || rng.chance(15) {
        return rng.pick(&GEBIETE).to_string();
    }
    dump.gebiete[rng.below(dump.gebiete.len() as u64) as usize].0.id.to_string()
}

/// Keys: mostly some that the Gebiet holds, so that clean-ups and hand-overs have something to do.
fn some_keys(rng: &mut Rng, dump: &Dump, gebiet: &str) -> Vec<Key> {
    let held: Vec<Key> = dump.marks.iter().filter(|(m, removed)| !removed && m.gebiet.as_str() == gebiet).map(|(m, _)| m.key.clone()).collect();
    (0..1 + rng.below(3))
        .map(|_| {
            if held.is_empty() || rng.chance(25) {
                key(&format!("{}:{}", if rng.chance(80) { "h" } else { "s" }, 1 + rng.below(12)))
            } else {
                rng.pick(&held).clone()
            }
        })
        .collect()
}

fn lauf_id(rng: &mut Rng, dump: &Dump) -> LaufId {
    if dump.laeufe.is_empty() || rng.chance(25) {
        LaufId::new(format!("l{}", 1 + rng.below(4)))
    } else {
        dump.laeufe[rng.below(dump.laeufe.len() as u64) as usize].id.clone()
    }
}

fn counts_of(dump: &Dump, gebiet: &str, keys: Option<&[Key]>) -> Counts {
    let wanted = |key: &Key| keys.is_none_or(|keys| keys.contains(key));
    Counts {
        marks: dump.marks.iter().filter(|(m, removed)| !removed && m.gebiet.as_str() == gebiet && wanted(&m.key)).count() as u32,
        notes: dump.notes.iter().filter(|n| !n.deleted && n.gebiet.as_str() == gebiet && wanted(&n.key)).count() as u32,
    }
}

fn gebiet_in(rng: &mut Rng, dump: &Dump, gebiet: &str) -> Body {
    let existing = dump.gebiete.iter().find(|(g, _)| g.id.as_str() == gebiet);
    let art = if rng.chance(97) { art_of(gebiet) } else { Art::Abholen };
    // an existing Gebiet keeps its Gruppe: giving a Gebiet to another Gruppe takes visibility away, which this test's devices are not told of
    let gruppe = match existing {
        Some((g, _)) => g.gruppe.as_ref().map(|g| g.as_str().to_string()),
        None if art == Art::Austeilen => rng.pick(&[Some("nord"), Some("nord"), Some("sued"), None, Some("west")]).map(String::from),
        None => None,
    };
    let base_rev = if existing.is_none() && rng.chance(90) { 0 } else { rev_guess(rng, gebiet_rev(dump, gebiet)) };
    let ring = base_ring(gebiet, rng);
    Body::Gebiet {
        gebiet: GebietIn { id: gid(gebiet), art, gruppe: gruppe.as_deref().map(gr), parent: parent_of(gebiet).map(gid), name: format!("Gebiet {gebiet}"), ring, base_rev },
    }
}

fn marks_in(rng: &mut Rng, now: u64, dump: &Dump, gebiet: &str) -> Body {
    let target = if rng.chance(3) { "ghost" } else { gebiet };
    let list = (0..1 + rng.below(4))
        .map(|_| {
            let wall = if rng.chance(3) { now + 3_600_000 } else { (now + rng.below(6000)).saturating_sub(3000) };
            let node = *rng.pick(&["a", "b", "c"]);
            let key = some_keys(rng, dump, target).remove(0);
            mark(key.as_str(), *rng.pick(&Status::ALL), op(wall, node))
        })
        .collect();
    super::marks(target, list)
}

fn note_in(rng: &mut Rng, now: u64, dump: &Dump, gebiet: &str) -> Body {
    let id = if dump.notes.is_empty() || rng.chance(50) {
        format!("note-{}", 1 + rng.below(6))
    } else {
        dump.notes[rng.below(dump.notes.len() as u64) as usize].id.to_string()
    };
    let k = if rng.chance(70) { format!("h:{}", 1 + rng.below(12)) } else { format!("a:{}", if rng.chance(90) { gebiet } else { "n1" }) };
    let wall = (now + rng.below(6000)).saturating_sub(3000);
    let text = if rng.chance(10) { String::new() } else { format!("text {}", rng.below(100)) };
    Body::Note { note: NoteIn { id: NoteId::new(id), key: key(&k), gebiet: gid(gebiet), flag: None, text, rev: op(wall, "n"), deleted: rng.chance(20) } }
}

fn cleanup(rng: &mut Rng, dump: &Dump, gebiet: &str) -> Body {
    let deleted = dump.gebiete.iter().find(|(g, _)| g.id.as_str() == gebiet).is_some_and(|(_, d)| *d);
    let (keys, expect) = if deleted && rng.chance(60) {
        (None, counts_of(dump, gebiet, None))
    } else {
        let keys = some_keys(rng, dump, gebiet);
        let right = counts_of(dump, gebiet, Some(&keys));
        (Some(keys), if rng.chance(80) { right } else { Counts { marks: right.marks + 1, ..right } })
    };
    Body::Cleanup { gebiet: gid(gebiet), keys, expect }
}

fn hand_over(rng: &mut Rng, dump: &Dump, gebiet: &str) -> Body {
    let same_world: Vec<_> = dump.gebiete.iter().filter(|(g, d)| !d && art_of(g.id.as_str()) == art_of(gebiet)).collect();
    let to = if same_world.is_empty() || rng.chance(10) { rng.pick(&GEBIETE).to_string() } else { rng.pick(&same_world).0.id.to_string() };
    Body::Move { from: gid(gebiet), to: gid(&to), keys: some_keys(rng, dump, gebiet) }
}

/// One random command. `now` is the server's time; `dump` is the state it will meet (the generator reads revisions and counts from it, as an app would).
pub fn command(rng: &mut Rng, now: u64, dump: &Dump) -> Body {
    let gebiet = pick_gebiet(rng, dump);
    let gebiet = gebiet.as_str();
    let gruppe = *rng.pick(&GRUPPEN);
    let gruppe_rev = dump.gruppen.iter().find(|(g, _)| g.id.as_str() == gruppe).map(|(g, _)| g.rev);
    match rng.below(100) {
        0..=34 => marks_in(rng, now, dump, gebiet),
        35..=44 => note_in(rng, now, dump, gebiet),
        45..=52 => {
            let base_rev = if rng.chance(30) { 0 } else { rev_guess(rng, gruppe_rev) };
            Body::Gruppe { gruppe: GruppeIn { id: gr(gruppe), name: format!("Gruppe {}", rng.below(5)), color: rng.below(33) as u8, base_rev } }
        }
        53..=54 => Body::GruppeRemove { id: gr(gruppe), base_rev: rev_guess(rng, gruppe_rev) },
        55..=66 => gebiet_in(rng, dump, gebiet),
        67..=68 => Body::GebietRemove { id: gid(gebiet), base_rev: rev_guess(rng, gebiet_rev(dump, gebiet)) },
        69..=73 => Body::Collect { gebiet: gid(gebiet) },
        74..=79 => {
            let taken: Vec<_> = dump.gebiete.iter().filter(|(g, _)| g.collected.is_some()).collect();
            let id = if taken.is_empty() || rng.chance(20) { gebiet.to_string() } else { rng.pick(&taken).0.id.to_string() };
            Body::Release { gebiet: gid(&id) }
        }
        80..=84 => {
            let id = LaufId::new(format!("l{}", 1 + rng.below(4)));
            Body::RunStart { run: LaufIn { id, gebiet: gid(gebiet), persons: rng.below(6) as u16, join: *rng.pick(&[Join::Closed, Join::Team, Join::Link]) } }
        }
        85..=87 => Body::RunUpdate { id: lauf_id(rng, dump), persons: rng.chance(60).then(|| rng.below(9) as u16), join: rng.chance(40).then_some(Join::Link) },
        88..=90 => Body::RunEnd { id: lauf_id(rng, dump) },
        91..=95 => cleanup(rng, dump, gebiet),
        _ => hand_over(rng, dump, gebiet),
    }
}

/// A fresh Aktion's first steps, so that random commands have something to meet.
pub fn seed_commands() -> Vec<Body> {
    vec![
        super::gruppe_in("nord", "nord"),
        super::gruppe_in("sued", "sued"),
        austeilen("n1", Some("nord"), square(13.00, 51.00, 0.005)),
        austeilen("n2", Some("nord"), square(13.00, 51.01, 0.005)),
        austeilen("s1", Some("sued"), square(13.01, 51.00, 0.005)),
        super::abholen("main", None, square(13.10, 51.00, 0.02)),
        super::abholen("p1", Some("main"), square(13.10, 51.00, 0.01)),
        super::abholen("p2", Some("main"), square(13.11, 51.00, 0.01)),
    ]
}
