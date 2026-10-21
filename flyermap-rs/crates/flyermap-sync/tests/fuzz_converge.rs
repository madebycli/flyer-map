//! Random edits on three devices with lost requests, lost answers, offline spells and wrong clocks always converge to the last writer and never
//! step backwards on a device.
mod support;
use flyermap_core::{Key, Status};
use std::collections::BTreeMap;
use support::{
    device::Device,
    server::{Fate, Server},
};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const T0: u64 = 1_800_000_000_000;
const KEYS: [&str; 6] = ["h:1", "h:2", "h:3", "s:1", "s:2", "s:3"];
const STATUSES: [Status; 4] = Status::ALL;

fn run(seed: u64) {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut server = Server::new(T0);
    server.page = 1 + rng.below(4) as usize;
    let mut devices: Vec<Device> = ["a", "b", "c"].iter().map(|n| Device::new(n, T0)).collect();
    devices[1].now = T0 - 600_000; // one phone is ten minutes behind
    devices[2].now = T0 + 90_000; // one is ahead
    let mut made: BTreeMap<String, (String, Status)> = BTreeMap::new(); // key -> (newest id, its status)
    let mut seen_at: Vec<BTreeMap<String, String>> = vec![BTreeMap::new(); 3];

    for _ in 0..120 {
        let d = rng.below(3) as usize;
        for dev in devices.iter_mut() {
            dev.now += rng.below(2000);
        }
        server.now += rng.below(2000);
        match rng.below(10) {
            0..=4 => {
                let key = KEYS[rng.below(KEYS.len() as u64) as usize];
                let status = STATUSES[rng.below(4) as usize];
                for op in devices[d].mark(key, status) {
                    let id = op.id.to_string();
                    if made.get(key).is_none_or(|(prior, _)| *prior < id) {
                        made.insert(key.to_string(), (id, status));
                    }
                }
            }
            5..=7 => {
                devices[d].fates = (0..rng.below(3))
                    .map(|_| [Fate::Deliver, Fate::Lost, Fate::LoseAnswer][rng.below(3) as usize])
                    .collect();
                devices[d].kick(&mut server);
            }
            8 => devices[d].fail_all = !devices[d].fail_all,
            _ => devices[d].retry(&mut server),
        }
        for (i, dev) in devices.iter().enumerate() {
            let findings = dev.store.check();
            assert!(
                findings.is_empty(),
                "seed {seed}: invariants broken on {}: {findings:?}",
                dev.name
            );
            for (key, entry) in dev.store.entries() {
                let at = entry.at.to_string();
                let prior = seen_at[i].insert(key.to_string(), at.clone());
                assert!(
                    prior.is_none_or(|p| p <= at),
                    "seed {seed}: {} went backwards on {key}",
                    dev.name
                );
            }
        }
    }

    // the network comes back for everybody; everything settles
    for dev in devices.iter_mut() {
        dev.fail_all = false;
        dev.fates.clear();
    }
    for _ in 0..30 {
        for dev in devices.iter_mut() {
            dev.retry(&mut server);
            dev.kick(&mut server);
        }
    }
    let truth = server.truth();
    for (key, (_, status)) in &made {
        assert_eq!(
            truth.get(key),
            Some(status),
            "seed {seed}: the server did not keep the last writer of {key}"
        );
    }
    for dev in &devices {
        assert_eq!(
            dev.store.pending_len(),
            0,
            "seed {seed}: {} still has queued edits",
            dev.name
        );
        for (key, status) in &truth {
            assert_eq!(
                dev.store.status_of(&Key::new(key.as_str())),
                *status,
                "seed {seed}: {} differs on {key}",
                dev.name
            );
        }
    }
}

#[test]
fn the_fuzz_converges() {
    for seed in 1..=300 {
        run(seed);
    }
}
