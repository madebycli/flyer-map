//! What the sheet of a house or a street piece says: the address or the name, where it lies, how many houses, and which keys a status choice sets. Pure: the
//! map data and the world in, text and keys out; the status itself is read from the store by the screen (it changes while the sheet is open).
use super::view::SubjectView;
use crate::{
    field::index::Index,
    marking::meters,
    model::{actions_for, Gebiet, Rights, Subject, SubjectContext, World},
    ui::{status, IconName},
};
use flyermap_core::{EntityKind, Key, Status};
use std::collections::HashMap;

pub struct ObjectView {
    pub view: SubjectView,
    /// What a status choice sets: the street piece, or the house.
    pub keys: Vec<Key>,
    /// The same with the houses along the piece (a house: just the house).
    pub keys_with_houses: Vec<Key>,
    pub is_street: bool,
}

fn gebiet_of<'a>(key: &Key, area_of: &HashMap<Key, String>, world: &'a World) -> Option<&'a Gebiet> {
    area_of.get(key).and_then(|id| world.gebiet(id))
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// `None` when the map data does not have it (any more).
pub fn describe_object(subject: &Subject, index: &Index, area_of: &HashMap<Key, String>, world: &World, rights: &Rights) -> Option<ObjectView> {
    let (title, icon, key, facts_of, keys, keys_with_houses, is_street) = match subject {
        Subject::Haus(id) => {
            let house = index.houses.get(id)?;
            let title = match (house.street.as_deref(), house.number.as_deref()) {
                (Some(street), Some(number)) => format!("{street} {number}"),
                _ => match house.parent.as_deref().and_then(|p| index.segments.get(p)).and_then(|s| s.name.clone()) {
                    Some(street) => format!("Haus an der {street}"),
                    None => "Haus ohne Adresse".to_string(),
                },
            };
            let key = Key::house(id);
            (title, IconName::House, key.clone(), Vec::new(), vec![key.clone()], vec![key], false)
        }
        Subject::Strasse(id) => {
            let seg = index.segments.get(id)?;
            let chunks = index.chunks_of(id);
            let length: f64 = chunks.iter().filter_map(|c| index.segments.get(c)).map(|s| s.length).sum();
            let keys = index.keys_for_segments(chunks.iter().map(String::as_str), false, false);
            let keys_with_houses = index.keys_for_segments(chunks.iter().map(String::as_str), true, false);
            let houses = keys_with_houses.iter().filter(|k| k.kind() == Some(EntityKind::House)).count();
            let title = seg.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Straße ohne Namen".to_string());
            (title, IconName::Road, Key::segment(id), vec![plural(houses, "Haus", "Häuser"), meters(length)], keys, keys_with_houses, true)
        }
        _ => return None,
    };
    let gebiet = gebiet_of(&key, area_of, world);
    let mut facts: Vec<String> = gebiet.map(|g| g.name.clone()).into_iter().collect();
    facts.extend(facts_of);
    let acts = actions_for(subject, &SubjectContext { world, rights, gebiet_of_key: gebiet });
    Some(ObjectView { view: SubjectView { icon, title, facts, acts, color: gebiet.map(|g| g.color.clone()) }, keys, keys_with_houses, is_street })
}

/// How a set of keys stands: one status for all of them (or none: they differ), and the houses among them done and in all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Summary {
    pub uniform: Option<Status>,
    pub houses_done: usize,
    pub houses: usize,
}

pub fn summarize(keys: &[Key], status_of: impl Fn(&Key) -> Status) -> Summary {
    let mut uniform: Option<Status> = None;
    let mut mixed = false;
    let (mut houses, mut done) = (0, 0);
    for key in keys {
        let s = status_of(key);
        match uniform {
            None if !mixed => uniform = Some(s),
            Some(u) if u != s => {
                uniform = None;
                mixed = true;
            }
            _ => {}
        }
        if key.kind() == Some(EntityKind::House) {
            houses += 1;
            done += usize::from(s == Status::Completed);
        }
    }
    Summary { uniform, houses_done: done, houses }
}

/// One line under the facts: what the status is, or how far the houses are.
pub fn status_line(sum: &Summary, kind: status::Kind, is_street: bool) -> String {
    if is_street && sum.houses > 0 {
        let word = status::label(kind, Status::Completed).to_lowercase();
        return match sum.uniform {
            Some(Status::Open) => "Noch nichts markiert".to_string(),
            _ => format!("{} von {} {word}", sum.houses_done, plural(sum.houses, "Haus", "Häusern")),
        };
    }
    match sum.uniform {
        Some(s) => status::label(kind, s).to_string(),
        None => "Unterschiedlich markiert".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        backend::mock::data::{grants, world, Persona, AKTION, ORG},
        engine::{House, Network, Segment},
        ui::status::Kind,
    };
    use flyermap_identity::{AktionId, OrgId};

    fn seg(id: &str, group: &str, chunk: u32, name: Option<&str>) -> Segment {
        Segment {
            id: id.into(),
            group: group.into(),
            chunk,
            name: name.map(Into::into),
            length: 120.0,
            from: "a".into(),
            to: "b".into(),
            house_count: 1,
            visible: true,
            mid: [13.0, 51.0],
            start: [13.0, 51.0],
        }
    }

    fn house(id: &str, parent: &str, street: Option<&str>, number: Option<&str>) -> House {
        House {
            id: id.into(),
            number: number.map(Into::into),
            street: street.map(Into::into),
            center: [13.0, 51.0],
            parent: Some(parent.into()),
            street_parent: None,
        }
    }

    fn field() -> (Index, HashMap<Key, String>) {
        let index = Index::new(&Network {
            segments: vec![seg("1#0", "1", 0, Some("Hauptstraße")), seg("1#1", "1", 1, Some("Hauptstraße")), seg("2#0", "2", 0, None)],
            houses: vec![house("a", "1#0", Some("Hauptstraße"), Some("12")), house("b", "1#1", None, None), house("c", "2#0", None, None)],
        });
        let gebiet = world(Persona::Admin).gebiete[0].id.clone();
        let area_of = ["h:a", "h:b", "h:c", "s:1#0", "s:1#1", "s:2#0"].iter().map(|k| (Key::new(*k), gebiet.clone())).collect();
        (index, area_of)
    }

    fn view(subject: Subject, persona: Persona) -> Option<ObjectView> {
        let (index, area_of) = field();
        let rights = Rights::new(grants(persona), OrgId::new(ORG), AktionId::new(AKTION), 1_800_000_000_000);
        describe_object(&subject, &index, &area_of, &world(persona), &rights)
    }

    #[test]
    fn a_house_is_named_by_its_address_or_its_street() {
        let a = view(Subject::Haus("a".into()), Persona::Admin).unwrap();
        assert_eq!(a.view.title, "Hauptstraße 12");
        assert_eq!(a.keys, [Key::house("a")]);
        assert_eq!(view(Subject::Haus("b".into()), Persona::Admin).unwrap().view.title, "Haus an der Hauptstraße");
        assert_eq!(view(Subject::Haus("c".into()), Persona::Admin).unwrap().view.title, "Haus ohne Adresse");
        assert!(view(Subject::Haus("zz".into()), Persona::Admin).is_none());
    }

    #[test]
    fn a_street_piece_counts_its_chunks_houses_and_metres() {
        let s = view(Subject::Strasse("1#1".into()), Persona::Admin).unwrap();
        assert_eq!(s.view.title, "Hauptstraße");
        assert!(s.is_street);
        assert_eq!(s.keys.len(), 2, "both chunks of the junction piece");
        assert_eq!(s.keys_with_houses.len(), 4, "and the two houses along it");
        assert_eq!(&s.view.facts[1..], ["2 Häuser", "240 m"]);
        assert_eq!(view(Subject::Strasse("2#0".into()), Persona::Admin).unwrap().view.title, "Straße ohne Namen");
    }

    #[test]
    fn rights_decide_whether_a_status_may_be_set() {
        let admin = view(Subject::Haus("a".into()), Persona::Admin).unwrap();
        assert!(admin.view.acts.contains(&crate::model::Act::SetStatus));
        let viewer = view(Subject::Haus("a".into()), Persona::Viewer).unwrap();
        assert!(!viewer.view.acts.contains(&crate::model::Act::SetStatus), "a viewer looks only");
    }

    #[test]
    fn a_summary_says_uniform_or_mixed_and_counts_houses() {
        let keys = [Key::segment("1#0"), Key::house("a"), Key::house("b")];
        let all_done = summarize(&keys, |_| Status::Completed);
        assert_eq!(all_done, Summary { uniform: Some(Status::Completed), houses_done: 2, houses: 2 });
        let mixed = summarize(&keys, |k| if k.as_str() == "h:a" { Status::Completed } else { Status::Open });
        assert_eq!(mixed, Summary { uniform: None, houses_done: 1, houses: 2 });
        assert_eq!(summarize(&[], |_| Status::Open).uniform, None);
    }

    #[test]
    fn the_line_says_it_in_words() {
        let d = Kind::Distribution;
        assert_eq!(status_line(&Summary { uniform: Some(Status::Completed), houses_done: 0, houses: 0 }, d, false), "Ausgeteilt");
        assert_eq!(status_line(&Summary { uniform: None, houses_done: 0, houses: 0 }, d, false), "Unterschiedlich markiert");
        assert_eq!(status_line(&Summary { uniform: None, houses_done: 3, houses: 5 }, d, true), "3 von 5 Häusern ausgeteilt");
        assert_eq!(status_line(&Summary { uniform: Some(Status::Open), houses_done: 0, houses: 5 }, d, true), "Noch nichts markiert");
        assert_eq!(status_line(&Summary { uniform: None, houses_done: 1, houses: 1 }, status::Kind::Collection, true), "1 von 1 Haus abgeholt");
    }
}
