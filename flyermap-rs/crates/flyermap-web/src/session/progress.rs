//! Progress per Gebiet, kept up to date from the store's changes (`flyermap_core::Progress` moves counters with each change instead of recounting).
//! Pure: the keys of the field and their Gebiet go in, snapshots come out.
use flyermap_core::{Changes, Key, Progress, ProgressSnapshot, Status};
use std::collections::HashMap;

pub struct Tracker {
    by_gebiet: HashMap<String, Progress>,
    area_of: HashMap<Key, String>,
}

impl Tracker {
    /// `houses`, `segments` (key and length) and `area_of` come from the field; `current` is every status the store already knows.
    pub fn new(houses: &[Key], segments: &[(Key, f64)], area_of: &HashMap<Key, String>, current: impl IntoIterator<Item = (Key, Status)>) -> Tracker {
        let gebiet = |key: &Key| area_of.get(key).cloned();
        let mut hs: HashMap<String, Vec<Key>> = HashMap::new();
        let mut ss: HashMap<String, Vec<(Key, f64)>> = HashMap::new();
        let mut cs: HashMap<String, Vec<(Key, Status)>> = HashMap::new();
        for k in houses {
            if let Some(g) = gebiet(k) {
                hs.entry(g).or_default().push(k.clone());
            }
        }
        for (k, len) in segments {
            if let Some(g) = gebiet(k) {
                ss.entry(g).or_default().push((k.clone(), *len));
            }
        }
        for (k, s) in current {
            if let Some(g) = gebiet(&k) {
                cs.entry(g).or_default().push((k, s));
            }
        }
        let names: std::collections::BTreeSet<String> = hs.keys().chain(ss.keys()).cloned().collect();
        let by_gebiet = names
            .into_iter()
            .map(|g| {
                let p = Progress::new(hs.remove(&g).unwrap_or_default(), ss.remove(&g).unwrap_or_default(), cs.remove(&g).unwrap_or_default());
                (g, p)
            })
            .collect();
        Tracker { by_gebiet, area_of: area_of.clone() }
    }

    /// Route every changed key to its Gebiet's counters.
    pub fn apply(&mut self, changes: &Changes) {
        let mut routed: HashMap<&String, Changes> = HashMap::new();
        for (key, status) in changes {
            if let Some(g) = self.area_of.get(key) {
                routed.entry(g).or_default().insert(key.clone(), *status);
            }
        }
        for (g, c) in routed {
            if let Some(p) = self.by_gebiet.get_mut(g) {
                p.apply(&c);
            }
        }
    }

    pub fn snapshots(&self) -> HashMap<String, ProgressSnapshot> {
        self.by_gebiet.iter().map(|(g, p)| (g.clone(), p.snapshot())).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Field = (Vec<Key>, Vec<(Key, f64)>, HashMap<Key, String>);

    fn field() -> Field {
        let houses = vec![Key::house("1"), Key::house("2"), Key::house("3")];
        let segments = vec![(Key::segment("a"), 100.0)];
        let area_of = HashMap::from([
            (Key::house("1"), "g1".to_string()),
            (Key::house("2"), "g1".to_string()),
            (Key::house("3"), "g2".to_string()),
            (Key::segment("a"), "g1".to_string()),
        ]);
        (houses, segments, area_of)
    }

    #[test]
    fn counts_start_from_the_known_statuses_per_gebiet() {
        let (h, s, a) = field();
        let t = Tracker::new(&h, &s, &a, [(Key::house("1"), Status::Completed)]);
        let snap = t.snapshots();
        assert_eq!(snap["g1"].houses, [1, 1, 0, 0]);
        assert_eq!(snap["g2"].houses, [1, 0, 0, 0]);
        assert_eq!(snap["g1"].street_meters[Status::Open.index()], 100.0);
    }

    #[test]
    fn a_change_moves_one_counter_in_its_own_gebiet() {
        let (h, s, a) = field();
        let mut t = Tracker::new(&h, &s, &a, []);
        let mut changes = Changes::new();
        changes.insert(Key::house("3"), Status::NotDeliverable);
        changes.insert(Key::segment("a"), Status::Completed);
        changes.insert(Key::house("unknown"), Status::Completed);
        t.apply(&changes);
        let snap = t.snapshots();
        assert_eq!(snap["g2"].houses, [0, 0, 0, 1]);
        assert_eq!(snap["g1"].houses, [2, 0, 0, 0]);
        assert_eq!(snap["g1"].street_meters[Status::Completed.index()], 100.0);
    }
}
