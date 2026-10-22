//! Which keys a marking gesture means (port of `src/v5/app/mark.ts`): a street piece with or without its houses, houses on paths that belong
//! to a street, "only streets with houses". Built once per derivation from the coordinate-free network.
use crate::engine::{House, Network, Segment};
use flyermap_core::Key;
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Default)]
pub struct Index {
    pub segments: HashMap<String, Segment>,
    pub houses: HashMap<String, House>,
    houses_by_segment: HashMap<String, Vec<String>>,
    /// Houses on a footway or path, by the street piece their address names: marking that piece takes them along.
    houses_by_street_parent: HashMap<String, Vec<(String, Option<String>)>>,
    /// The chunks of every junction-to-junction piece, in order.
    chunks_by_group: HashMap<String, Vec<String>>,
    /// Houses along each junction-to-junction piece ("Nur Straßen mit Häusern" skips those with none).
    group_houses: HashMap<String, u32>,
}

impl Index {
    pub fn new(network: &Network) -> Index {
        let mut index = Index::default();
        for house in &network.houses {
            if let Some(path) = &house.street_parent {
                index.houses_by_street_parent.entry(path.clone()).or_default().push((house.id.clone(), house.parent.clone()));
            }
            if let Some(parent) = &house.parent {
                index.houses_by_segment.entry(parent.clone()).or_default().push(house.id.clone());
            }
            index.houses.insert(house.id.clone(), house.clone());
        }
        let mut chunks: HashMap<String, Vec<(u32, String)>> = HashMap::new();
        for s in &network.segments {
            chunks.entry(s.group.clone()).or_default().push((s.chunk, s.id.clone()));
            *index.group_houses.entry(s.group.clone()).or_default() += s.house_count;
            index.segments.insert(s.id.clone(), s.clone());
        }
        for (group, mut list) in chunks {
            list.sort();
            index.chunks_by_group.insert(group, list.into_iter().map(|(_, id)| id).collect());
        }
        index
    }

    fn has_houses(&self, segment: &Segment) -> bool {
        self.group_houses.get(&segment.group).copied().unwrap_or(0) > 0
    }

    /// Every chunk of the tapped junction-to-junction pieces, optionally with their houses.
    pub fn keys_for_groups<'a>(&self, segment_ids: impl IntoIterator<Item = &'a str>, with_houses: bool, houses_only: bool) -> Vec<Key> {
        let mut ids: Vec<String> = Vec::new();
        for id in segment_ids {
            let Some(segment) = self.segments.get(id) else { continue };
            match self.chunks_by_group.get(&segment.group) {
                Some(chunks) => ids.extend(chunks.iter().cloned()),
                None => ids.push(id.to_string()),
            }
        }
        self.keys_for_segments(ids.iter().map(String::as_str), with_houses, houses_only)
    }

    /// Street pieces, optionally with their houses. Houses on a path whose address names one of the pieces come along, and so does such a path
    /// piece once every house on it is taken: a path is never marked for its own sake.
    pub fn keys_for_segments<'a>(&self, segment_ids: impl IntoIterator<Item = &'a str>, with_houses: bool, houses_only: bool) -> Vec<Key> {
        let mut keys: Vec<Key> = Vec::new();
        let mut seen: HashSet<Key> = HashSet::new();
        let mut push = |keys: &mut Vec<Key>, key: Key| {
            if seen.insert(key.clone()) {
                keys.push(key);
            }
        };
        let mut paths: BTreeSet<String> = BTreeSet::new();
        for id in segment_ids {
            let Some(segment) = self.segments.get(id) else { continue };
            if !segment.visible || (houses_only && !self.has_houses(segment)) {
                continue;
            }
            push(&mut keys, Key::segment(id));
            if with_houses {
                for house in self.houses_by_segment.get(id).into_iter().flatten() {
                    push(&mut keys, Key::house(house));
                }
                for (house, path) in self.houses_by_street_parent.get(id).into_iter().flatten() {
                    push(&mut keys, Key::house(house));
                    paths.extend(path.clone());
                }
            }
        }
        let taken: HashSet<Key> = keys.iter().cloned().collect();
        for path in paths {
            let visible = self.segments.get(&path).is_some_and(|s| s.visible);
            let all_taken = self.houses_by_segment.get(&path).into_iter().flatten().all(|h| taken.contains(&Key::house(h)));
            if visible && all_taken {
                push(&mut keys, Key::segment(&path));
            }
        }
        keys
    }

    /// What a finger passed over: houses exactly, street pieces with their houses when asked.
    pub fn keys_for_touched<'a>(
        &self,
        houses: impl IntoIterator<Item = &'a str>,
        segments: impl IntoIterator<Item = &'a str>,
        with_houses: bool,
        houses_only: bool,
    ) -> Vec<Key> {
        let mut keys = self.keys_for_segments(segments, with_houses, houses_only);
        let mut seen: HashSet<Key> = keys.iter().cloned().collect();
        for id in houses {
            let key = Key::house(id);
            if self.houses.contains_key(id) && seen.insert(key.clone()) {
                keys.push(key);
            }
        }
        keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, group: &str, chunk: u32, houses: u32, visible: bool) -> Segment {
        Segment {
            id: id.into(),
            group: group.into(),
            chunk,
            name: Some("A".into()),
            length: 10.0,
            from: "n".into(),
            to: "m".into(),
            house_count: houses,
            visible,
            mid: [0.0, 0.0],
            start: [0.0, 0.0],
        }
    }
    fn house(id: &str, parent: &str, street_parent: Option<&str>) -> House {
        House { id: id.into(), center: [0.0, 0.0], parent: Some(parent.into()), street_parent: street_parent.map(str::to_string) }
    }
    fn index() -> Index {
        Index::new(&Network {
            segments: vec![seg("1#1", "1", 1, 1, true), seg("1#0", "1", 0, 1, true), seg("2#0", "2", 0, 0, true), seg("p#0", "p", 0, 1, true)],
            houses: vec![house("a", "1#0", None), house("b", "1#1", None), house("c", "p#0", Some("2#0"))],
        })
    }
    fn names(keys: &[Key]) -> Vec<&str> {
        keys.iter().map(Key::as_str).collect()
    }

    #[test]
    fn a_tap_takes_the_whole_junction_piece_with_its_houses() {
        let keys = index().keys_for_groups(["1#1"], true, false);
        assert_eq!(names(&keys), ["s:1#0", "h:a", "s:1#1", "h:b"]);
        assert_eq!(names(&index().keys_for_groups(["1#1"], false, false)), ["s:1#0", "s:1#1"]);
    }

    #[test]
    fn houses_on_a_path_come_with_their_street_and_then_the_path() {
        let keys = index().keys_for_segments(["2#0"], true, false);
        assert_eq!(names(&keys), ["s:2#0", "h:c", "s:p#0"]);
    }

    #[test]
    fn only_streets_with_houses_skips_the_empty_ones() {
        assert!(index().keys_for_segments(["2#0"], true, true).is_empty());
        let touched = index().keys_for_touched(["b", "zz"], ["2#0"], false, true);
        assert_eq!(names(&touched), ["h:b"], "an unknown house is dropped");
    }
}
