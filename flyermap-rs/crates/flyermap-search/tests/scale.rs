//! The size of a real Aktion (Plan 061 §10: 51 000 houses): how long building takes, how much memory the index holds, how long a keystroke
//! takes to answer. Run on purpose, in release mode, to see the numbers:
//!
//!     cargo test -p flyermap-search --release --test scale -- --ignored --nocapture
mod common;
use common::*;
use flyermap_search::*;
use std::time::{Duration, Instant};

const STREETS: usize = 1_600;
const HOUSES_PER_STREET: usize = 32;

/// A small deterministic generator, so the town is the same on every run without a dependency.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) as usize) % below
    }
}

fn big_town() -> Vec<Entry> {
    const START: [&str; 20] = [
        "Haupt",
        "Bahnhof",
        "Schiller",
        "Goethe",
        "Linden",
        "Ulmen",
        "Eichen",
        "Birken",
        "Rosen",
        "Garten",
        "Kirch",
        "Markt",
        "Schul",
        "Mühlen",
        "Wald",
        "Berg",
        "Wiesen",
        "Berliner",
        "Hamburger",
        "Münchner",
    ];
    const MIDDLE: [&str; 20] = [
        "", "feld", "tal", "hof", "park", "damm", "ring", "stein", "bach", "wiese", "heide", "see", "au", "hain", "horst", "brink", "rain", "anger", "kamp",
        "furt",
    ];
    const END: [&str; 4] = ["straße", "weg", "allee", "platz"];
    let mut rng = Lcg(7);
    let mut all = Vec::with_capacity(STREETS * (HOUSES_PER_STREET + 1));
    for s in 0..STREETS {
        let name = format!("{}{}{}", START[s % 20], MIDDLE[(s / 20) % 20], END[(s / 400) % 4]);
        let id = format!("s:{s}");
        let centre = at(13.0 + (s % 40) as f64 * 0.004, 52.0 + (s / 40) as f64 * 0.003);
        let area = format!("a:{}", s / 100);
        all.push(street(&id, &name, centre, Some(&area)));
        for n in 1..=HOUSES_PER_STREET {
            let addition = ["", "", "", "a", "b"][rng.next(5)];
            all.push(house(&name, &format!("{n}{addition}"), centre, Some(&area)));
        }
    }
    all.extend((0..16).map(|a| Entry::Area(Area { id: format!("a:{a}").into(), name: format!("Gebiet {a}"), art: Art::Austeilen, center: None })));
    all.extend((0..400).map(|p| Entry::Person(Person { id: format!("p:{p}").into(), name: format!("{} {}", START[p % 20], MIDDLE[p % 19 + 1]) })));
    all.push(command("c:new-area", "Neues Gebiet", &["neu", "anlegen"], true, 90));
    all
}

fn average(index: &Index, query: &Query, rounds: u32) -> Duration {
    let started = Instant::now();
    for _ in 0..rounds {
        std::hint::black_box(index.search(query));
    }
    started.elapsed() / rounds
}

#[test]
#[ignore = "a measurement, not a test: run it with --release --ignored --nocapture"]
fn a_whole_city_answers_at_typing_speed() {
    let entries = big_town();
    let count = entries.len();
    let started = Instant::now();
    let index = Index::build(entries);
    let built = started.elapsed();
    assert_eq!((index.len(), index.rejected()), (count, 0));
    let memory = index.memory();
    println!(
        "{count} entries built in {built:?}; memory {} kB (entries {}, labels {}, vocabulary {}, lookup {})",
        memory.total() / 1024,
        memory.entries / 1024,
        memory.labels / 1024,
        memory.vocabulary / 1024,
        memory.lookup / 1024
    );

    let context = Context { center: Some(at(13.05, 52.02)), ..Context::default() };
    let mut worst = Duration::ZERO;
    for text in ["h", "ha", "haupt", "hauptstr", "hauptstrase", "hauptstr 12", "12a", "12", "bahnhofstr 3", "straße", "str", "neu", "müllenfeld", "xq"] {
        let query = Query { text: text.to_string(), context: context.clone() };
        let found = index.search(&query).len();
        let took = average(&index, &query, 20);
        worst = worst.max(took);
        println!("{text:>14}: {found:>3} hits in {took:?}");
    }
    println!("worst keystroke: {worst:?}");
}
