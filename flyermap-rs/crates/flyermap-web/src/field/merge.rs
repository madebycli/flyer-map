//! The Gebiete of an Aktion as one field network (port of `mergeNetworks` in `src/v5/engine/area.ts`). Overlapping Gebiete share OSM ids, so a
//! house or street piece seen twice keeps one entry (the first Gebiet wins) and therefore one status and one Gebiet for the server's rights.
use crate::engine::Network;
use flyermap_core::Key;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct Merged {
    pub network: Network,
    /// The Gebiet of every key (`s:…`, `h:…`): what each edit is sent with.
    pub area_of: HashMap<Key, String>,
}

/// `parts`: (Gebiet id, network of the Gebiet or of one of its parts) in the order of the Gebiete.
pub fn merge(parts: Vec<(String, Network)>) -> Merged {
    let mut out = Merged::default();
    let (mut segments, mut houses) = (HashSet::new(), HashSet::new());
    for (area, network) in parts {
        for s in network.segments {
            if segments.insert(s.id.clone()) {
                out.area_of.insert(Key::segment(&s.id), area.clone());
                out.network.segments.push(s);
            }
        }
        for h in network.houses {
            if houses.insert(h.id.clone()) {
                out.area_of.insert(Key::house(&h.id), area.clone());
                out.network.houses.push(h);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{House, Segment};

    pub fn seg(id: &str, group: &str) -> Segment {
        Segment {
            id: id.into(),
            group: group.into(),
            chunk: 0,
            name: Some("A".into()),
            length: 10.0,
            from: "n1".into(),
            to: "n2".into(),
            house_count: 0,
            visible: true,
            mid: [0.0, 0.0],
            start: [0.0, 0.0],
        }
    }

    fn house(id: &str) -> House {
        House { id: id.into(), number: None, street: None, center: [0.0, 0.0], parent: None, street_parent: None }
    }

    #[test]
    fn the_first_gebiet_wins() {
        let a = Network { segments: vec![seg("1", "1"), seg("2", "2")], houses: vec![house("h1")] };
        let b = Network { segments: vec![seg("2", "2"), seg("3", "3")], houses: vec![house("h1"), house("h2")] };
        let m = merge(vec![("a".into(), a), ("b".into(), b)]);
        assert_eq!(m.network.segments.len(), 3);
        assert_eq!(m.network.houses.len(), 2);
        assert_eq!(m.area_of[&Key::segment("2")], "a");
        assert_eq!(m.area_of[&Key::house("h1")], "a");
        assert_eq!(m.area_of[&Key::house("h2")], "b");
    }
}
