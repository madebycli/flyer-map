//! What the search can find, made from what the app holds: Gebiete, Gruppen and people from the world; streets and houses from the loaded map data. Every
//! entry id carries its kind ("a:", "g:", "p:", "s:", "h:") because the index has one namespace; [`target`] reads it back. Pure.
use crate::{
    engine::Segment,
    field::index::Index as FieldIndex,
    model::{ring_center, Subject, World},
};
use flyermap_core::Key;
use flyermap_identity::Art;
use flyermap_search::{Area, Art as SearchArt, Entry, Group, House as SearchHouse, Id, Person, Point, Street};
use std::collections::{BTreeMap, HashMap};

pub fn area_id(id: &str) -> Id {
    Id::from(format!("a:{id}"))
}

/// Gebiete, Gruppen and (when the person may manage people) people.
pub fn world_entries(world: &World, with_people: bool) -> Vec<Entry> {
    let mut out = Vec::new();
    for g in &world.gebiete {
        let art = if g.art == Art::Abholen { SearchArt::Abholen } else { SearchArt::Austeilen };
        out.push(Entry::Area(Area { id: area_id(&g.id), name: g.name.clone(), art, center: ring_center(&g.ring).map(|c| Point::new(c[0], c[1])) }));
    }
    for g in &world.gruppen {
        out.push(Entry::Group(Group { id: Id::from(format!("g:{}", g.id)), name: g.name.clone() }));
    }
    if with_people {
        for p in &world.personen {
            out.push(Entry::Person(Person { id: Id::from(format!("p:{}", p.id)), name: p.label.clone() }));
        }
    }
    out
}

/// The first chunk of every junction-to-junction piece: what the map focuses on and the sheet is opened for.
fn first_chunks<'a>(pieces: impl Iterator<Item = &'a Segment>) -> Vec<&'a Segment> {
    let mut by_group: BTreeMap<&str, &Segment> = BTreeMap::new();
    for s in pieces {
        let slot = by_group.entry(s.group.as_str()).or_insert(s);
        if s.chunk < slot.chunk {
            *slot = s;
        }
    }
    by_group.into_values().collect()
}

/// One entry per street name (all its visible pieces), one per house with a street and a number.
pub fn field_entries(index: &FieldIndex, area_of: &HashMap<Key, String>) -> Vec<Entry> {
    let area = |key: Key| area_of.get(&key).map(|g| area_id(g));
    let mut named: BTreeMap<&str, Vec<&Segment>> = BTreeMap::new();
    for s in index.segments.values().filter(|s| s.visible) {
        if let Some(name) = s.name.as_deref().filter(|n| !n.trim().is_empty()) {
            named.entry(name).or_default().push(s);
        }
    }
    let mut out = Vec::with_capacity(named.len() + index.houses.len());
    for (name, segments) in named {
        let pieces = first_chunks(segments.iter().copied());
        let n = pieces.len() as f64;
        let center = pieces.iter().fold([0.0, 0.0], |c, s| [c[0] + s.mid[0] / n, c[1] + s.mid[1] / n]);
        let Some(first) = pieces.first() else { continue };
        out.push(Entry::Street(Street {
            id: Id::from(format!("s:{name}")),
            name: name.to_string(),
            pieces: pieces.iter().map(|s| Id::from(format!("s:{}", s.id))).collect(),
            center: Point::new(center[0], center[1]),
            area: area(Key::segment(&first.id)),
        }));
    }
    for h in index.houses.values() {
        let (Some(street), Some(number)) = (h.street.as_deref(), h.number.as_deref()) else { continue };
        out.push(Entry::House(SearchHouse {
            id: Id::from(format!("h:{}", h.id)),
            street: street.to_string(),
            number: number.to_string(),
            position: Point::new(h.center[0], h.center[1]),
            area: area(Key::house(&h.id)),
        }));
    }
    out
}

/// Of the pieces of a street (entry ids "s:<piece>"), the one whose middle is nearest `near` (lng, lat): the piece a person standing there means.
/// Without a position, the first. Returns the engine's piece id.
pub fn nearest_piece(pieces: &[Id], index: &FieldIndex, near: Option<[f64; 2]>) -> Option<String> {
    let ids = pieces.iter().filter_map(|p| p.as_str().strip_prefix("s:")).filter(|id| index.segments.contains_key(*id));
    let Some(near) = near else { return ids.map(str::to_string).next() };
    let k = near[1].to_radians().cos();
    let distance = |id: &&str| {
        let mid = index.segments[*id].mid;
        ((mid[0] - near[0]) * k).powi(2) + (mid[1] - near[1]).powi(2)
    };
    ids.min_by(|a, b| distance(a).total_cmp(&distance(b)).then_with(|| a.cmp(b))).map(str::to_string)
}

/// What an entry id means for the app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// A street by its name and the id of one of its pieces (the piece nearest the person is chosen by the caller).
    Street {
        name: String,
    },
    Subject(Subject),
}

/// Read an entry id back. Commands ("cmd:") are not a target.
pub fn target(id: &str) -> Option<Target> {
    let (kind, rest) = id.split_once(':')?;
    let subject = match kind {
        "a" => Subject::Gebiet(rest.to_string()),
        "g" => Subject::Gruppe(rest.to_string()),
        "p" => Subject::Person(rest.to_string()),
        "h" => Subject::Haus(rest.to_string()),
        "s" => return Some(Target::Street { name: rest.to_string() }),
        _ => return None,
    };
    Some(Target::Subject(subject))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        backend::mock::data::{world, Persona},
        engine::{House, Network},
    };

    fn seg(id: &str, group: &str, chunk: u32, name: Option<&str>, mid: [f64; 2], visible: bool) -> Segment {
        Segment {
            id: id.into(),
            group: group.into(),
            chunk,
            name: name.map(Into::into),
            length: 10.0,
            from: "a".into(),
            to: "b".into(),
            house_count: 0,
            visible,
            mid,
            start: mid,
        }
    }

    fn house(id: &str, street: Option<&str>, number: Option<&str>) -> House {
        House { id: id.into(), number: number.map(Into::into), street: street.map(Into::into), center: [13.0, 51.0], parent: None, street_parent: None }
    }

    fn field() -> (FieldIndex, HashMap<Key, String>) {
        let network = Network {
            segments: vec![
                seg("1#0", "1", 0, Some("Hauptstraße"), [13.0, 51.0], true),
                seg("1#1", "1", 1, Some("Hauptstraße"), [13.001, 51.0], true),
                seg("2#0", "2", 0, Some("Hauptstraße"), [13.0, 51.002], true),
                seg("3#0", "3", 0, Some("Hinterweg"), [13.0, 51.0], false),
                seg("4#0", "4", 0, None, [13.0, 51.0], true),
            ],
            houses: vec![house("a", Some("Hauptstraße"), Some("12a")), house("b", Some("Hauptstraße"), None), house("c", None, Some("3"))],
        };
        let area_of = HashMap::from([(Key::segment("1#0"), "nord".to_string()), (Key::house("a"), "nord".to_string())]);
        (FieldIndex::new(&network), area_of)
    }

    #[test]
    fn a_street_is_one_entry_with_its_pieces_and_a_house_needs_street_and_number() {
        let (index, area_of) = field();
        let entries = field_entries(&index, &area_of);
        let streets: Vec<&Street> = entries.iter().filter_map(|e| if let Entry::Street(s) = e { Some(s) } else { None }).collect();
        assert_eq!(streets.len(), 1, "a hidden piece and a piece without a name make no street");
        assert_eq!(streets[0].name, "Hauptstraße");
        assert_eq!(streets[0].pieces.iter().map(Id::as_str).collect::<Vec<_>>(), ["s:1#0", "s:2#0"], "the first chunk of each junction piece");
        assert_eq!(streets[0].area.as_ref().map(Id::as_str), Some("a:nord"));
        let houses: Vec<&SearchHouse> = entries.iter().filter_map(|e| if let Entry::House(h) = e { Some(h) } else { None }).collect();
        assert_eq!(houses.len(), 1);
        assert_eq!((houses[0].street.as_str(), houses[0].number.as_str(), houses[0].id.as_str()), ("Hauptstraße", "12a", "h:a"));
    }

    #[test]
    fn the_world_gives_gebiete_gruppen_and_only_for_managers_people() {
        let w = world(Persona::Admin);
        let with = world_entries(&w, true);
        let without = world_entries(&w, false);
        let count = |list: &[Entry], f: fn(&Entry) -> bool| list.iter().filter(|e| f(e)).count();
        assert_eq!(count(&with, |e| matches!(e, Entry::Area(_))), w.gebiete.len());
        assert_eq!(count(&with, |e| matches!(e, Entry::Group(_))), w.gruppen.len());
        assert_eq!(count(&with, |e| matches!(e, Entry::Person(_))), w.personen.len());
        assert_eq!(count(&without, |e| matches!(e, Entry::Person(_))), 0);
    }

    #[test]
    fn of_the_pieces_of_a_street_the_one_nearest_the_person_is_meant() {
        let (index, _) = field();
        let pieces = [Id::new("s:1#0"), Id::new("s:2#0"), Id::new("s:gone#0")];
        assert_eq!(nearest_piece(&pieces, &index, Some([13.0, 51.0019])).as_deref(), Some("2#0"));
        assert_eq!(nearest_piece(&pieces, &index, Some([13.0, 51.0])).as_deref(), Some("1#0"));
        assert_eq!(nearest_piece(&pieces, &index, None).as_deref(), Some("1#0"), "without a position the first that exists");
        assert_eq!(nearest_piece(&[Id::new("s:gone#0")], &index, None), None);
    }

    #[test]
    fn an_entry_id_reads_back_as_what_it_names() {
        assert_eq!(target("a:nord"), Some(Target::Subject(Subject::Gebiet("nord".into()))));
        assert_eq!(target("h:b504"), Some(Target::Subject(Subject::Haus("b504".into()))));
        assert_eq!(target("s:Hauptstraße"), Some(Target::Street { name: "Hauptstraße".into() }));
        assert_eq!(target("cmd:help"), None);
        assert_eq!(target("nonsense"), None);
    }
}
