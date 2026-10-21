//! Houses and street metres per status, kept up to date from the store's changes. Counters move with each change (no recount).
use crate::{changes::Changes, key::Key, status::Status};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq)]
pub struct ProgressSnapshot {
    pub houses: [i64; 4],
    /// Metres of visible street per status.
    pub street_meters: [f64; 4],
    pub total_houses: i64,
    pub total_street_meters: f64,
    /// completed / (all − not deliverable), in 0..=1.
    pub house_ratio: f64,
}

impl ProgressSnapshot {
    pub fn houses_with(&self, status: Status) -> i64 {
        self.houses[status.index()]
    }
}

#[derive(Debug)]
pub struct Progress {
    houses: [i64; 4],
    meters: [f64; 4],
    house_keys: HashSet<Key>,
    meter_of: HashMap<Key, f64>,
    last: HashMap<Key, Status>,
}

impl Progress {
    /// `houses`: the keys of all houses; `segments`: key and length of every visible street piece; `current`: the statuses already known.
    pub fn new(
        houses: impl IntoIterator<Item = Key>,
        segments: impl IntoIterator<Item = (Key, f64)>,
        current: impl IntoIterator<Item = (Key, Status)>,
    ) -> Progress {
        let house_keys: HashSet<Key> = houses.into_iter().collect();
        let meter_of: HashMap<Key, f64> = segments.into_iter().collect();
        let mut p = Progress { houses: [0; 4], meters: [0.0; 4], last: HashMap::new(), meter_of, house_keys };
        p.houses[Status::Open.index()] = p.house_keys.len() as i64;
        p.meters[Status::Open.index()] = p.meter_of.values().sum();
        for (key, status) in current {
            p.move_key(&key, Status::Open, status);
        }
        p
    }

    fn move_key(&mut self, key: &Key, from: Status, to: Status) {
        if from == to {
            return;
        }
        if self.house_keys.contains(key) {
            self.houses[from.index()] -= 1;
            self.houses[to.index()] += 1;
        } else if let Some(length) = self.meter_of.get(key) {
            self.meters[from.index()] -= length;
            self.meters[to.index()] += length;
        } else {
            return;
        }
        self.last.insert(key.clone(), to);
    }

    pub fn apply(&mut self, changes: &Changes) {
        for (key, status) in changes {
            let from = self.last.get(key).copied().unwrap_or(Status::Open);
            self.move_key(key, from, *status);
        }
    }

    pub fn snapshot(&self) -> ProgressSnapshot {
        let total: i64 = self.houses.iter().sum();
        let deliverable = total - self.houses[Status::NotDeliverable.index()];
        ProgressSnapshot {
            houses: self.houses,
            street_meters: self.meters,
            total_houses: total,
            total_street_meters: self.meters.iter().sum(),
            house_ratio: if deliverable > 0 { self.houses[Status::Completed.index()] as f64 / deliverable as f64 } else { 0.0 },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress() -> Progress {
        Progress::new(
            [Key::house("1"), Key::house("2"), Key::house("3")],
            [(Key::segment("a"), 100.0), (Key::segment("b"), 50.0)],
            [(Key::house("1"), Status::Completed)],
        )
    }

    #[test]
    fn counts_start_from_what_is_known() {
        let s = progress().snapshot();
        assert_eq!(s.houses, [2, 1, 0, 0]);
        assert_eq!(s.street_meters, [150.0, 0.0, 0.0, 0.0]);
        assert!((s.house_ratio - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn a_change_moves_one_house_and_never_counts_twice() {
        let mut p = progress();
        let mut changes = Changes::new();
        changes.insert(Key::house("2"), Status::NotDeliverable);
        changes.insert(Key::segment("a"), Status::Completed);
        changes.insert(Key::new("h:unknown"), Status::Completed);
        p.apply(&changes);
        p.apply(&changes);
        let s = p.snapshot();
        assert_eq!(s.houses, [1, 1, 0, 1]);
        assert_eq!(s.street_meters, [50.0, 100.0, 0.0, 0.0]);
        assert_eq!(s.total_houses, 3);
        assert!((s.house_ratio - 0.5).abs() < 1e-9, "not deliverable leaves the denominator");
    }

    #[test]
    fn nothing_deliverable_is_zero_percent() {
        let p = Progress::new([Key::house("1")], [], [(Key::house("1"), Status::NotDeliverable)]);
        assert_eq!(p.snapshot().house_ratio, 0.0);
    }
}
