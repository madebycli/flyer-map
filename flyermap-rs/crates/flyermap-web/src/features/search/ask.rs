//! Asking the search and showing its answer: the situation of the person (where the map is, which Gebiet, what was used lately, what they may see) goes in as
//! the search's context; the hits come out as groups for the card. The ranking and the typo tolerance are `flyermap-search`'s; this only translates.
use super::{commands::spec_of_key, entries::area_id, recents::Recents};
use crate::ui::{Hit, HitKind, ResultGroup};
use flyermap_search::{Context, Index, Kind, KindSet, Point, Query, Results};

/// How many hits the search is asked for.
const LIMIT: usize = 20;
/// How many of one kind the card shows (the rest is one more letter away).
const PER_GROUP: usize = 6;

/// The person's situation as far as the search cares.
#[derive(Clone, Debug, Default)]
pub struct Situation {
    /// The middle of the map (lng, lat).
    pub center: Option<[f64; 2]>,
    /// The Gebiet under the middle of the map.
    pub area: Option<String>,
    pub recents: Recents,
    /// Whether people may be searched for (those who manage people).
    pub with_people: bool,
}

fn kinds(with_people: bool) -> KindSet {
    let all = KindSet::ALL.without(Kind::Note);
    if with_people {
        all
    } else {
        all.without(Kind::Person)
    }
}

fn hit_kind(kind: Kind) -> HitKind {
    match kind {
        Kind::Command => HitKind::Command,
        Kind::Street => HitKind::Street,
        Kind::House => HitKind::House,
        Kind::Area => HitKind::Gebiet,
        Kind::Group => HitKind::Gruppe,
        Kind::Person => HitKind::Person,
        // notes are not in the app yet; a hit of that kind reads as a street, the nearest thing to "a place on the map"
        Kind::Note => HitKind::Street,
    }
}

fn title_of(kind: Kind) -> &'static str {
    match kind {
        Kind::Command => "Befehle",
        Kind::Street => "Straßen",
        Kind::House => "Häuser",
        Kind::Area => "Gebiete",
        Kind::Group => "Gruppen",
        Kind::Person => "Personen",
        Kind::Note => "Notizen",
    }
}

fn to_hit(h: &flyermap_search::Hit) -> Hit {
    let id = h.entry.id().as_str().to_string();
    Hit {
        icon: spec_of_key(&id).map(|s| s.icon),
        id,
        kind: hit_kind(h.kind),
        label: h.title.clone(),
        detail: h.subtitle.clone(),
        marks: h.highlights.iter().map(|r| (r.start, r.end)).collect(),
    }
}

/// The groups the card shows. Nothing typed: what was used lately ("Zuletzt"), then the commands. Typed: one group per kind, the kind of the best hit first.
pub fn present(results: &Results, typed: bool) -> Vec<ResultGroup> {
    if !typed {
        let (commands, recent): (Vec<_>, Vec<_>) = results.hits.iter().partition(|h| h.kind == Kind::Command);
        let group = |title, hits: Vec<&flyermap_search::Hit>| ResultGroup { title, hits: hits.into_iter().map(to_hit).collect() };
        return [group("Zuletzt", recent), group("Befehle", commands)].into_iter().filter(|g| !g.hits.is_empty()).collect();
    }
    results
        .groups
        .iter()
        .map(|g| ResultGroup { title: title_of(g.kind), hits: g.hits.iter().take(PER_GROUP).map(|&i| to_hit(&results.hits[i])).collect() })
        .collect()
}

/// Ask `index` for `text` in the situation and present what it found.
pub fn ask(index: &Index, text: &str, s: &Situation) -> Vec<ResultGroup> {
    let context = Context {
        center: s.center.map(|c| Point::new(c[0], c[1])),
        area: s.area.as_deref().map(area_id),
        recent: s.recents.for_search(),
        kinds: kinds(s.with_people),
        limit: LIMIT,
    };
    let results = index.search(&Query { text: text.to_string(), context });
    present(&results, !text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        backend::mock::data::{world, Persona},
        engine::{House, Network, Segment},
        features::search::{
            commands::{entries as command_entries, Avail},
            entries::{field_entries, world_entries},
        },
        field::index::Index as FieldIndex,
    };
    use flyermap_core::Key;
    use std::collections::HashMap;

    fn seg(id: &str, name: &str, mid: [f64; 2]) -> Segment {
        Segment {
            id: id.into(),
            group: id.into(),
            chunk: 0,
            name: Some(name.into()),
            length: 50.0,
            from: "a".into(),
            to: "b".into(),
            house_count: 2,
            visible: true,
            mid,
            start: mid,
        }
    }

    fn house(id: &str, street: &str, number: &str) -> House {
        House { id: id.into(), number: Some(number.into()), street: Some(street.into()), center: [13.0, 51.0], parent: None, street_parent: None }
    }

    fn index(with_people: bool) -> Index {
        let w = world(Persona::Admin);
        let network = Network {
            segments: vec![seg("1#0", "Hauptstraße", [13.0, 51.0]), seg("2#0", "Mühlenweg", [13.01, 51.01])],
            houses: vec![house("a", "Hauptstraße", "12a"), house("b", "Hauptstraße", "14"), house("c", "Mühlenweg", "3")],
        };
        let area_of: HashMap<Key, String> = HashMap::new();
        let mut all = world_entries(&w, with_people);
        all.extend(field_entries(&FieldIndex::new(&network), &area_of));
        all.extend(command_entries(Avail { wide: false, may_mark: true, may_draw: true }));
        Index::build(all)
    }

    fn labels(groups: &[ResultGroup]) -> Vec<(&str, Vec<&str>)> {
        groups.iter().map(|g| (g.title, g.hits.iter().map(|h| h.label.as_str()).collect())).collect()
    }

    #[test]
    fn a_street_is_found_by_a_part_with_umlauts_and_typos_forgiven() {
        let idx = index(true);
        let s = Situation::default();
        let by = |q: &str| ask(&idx, q, &s).into_iter().flat_map(|g| g.hits).find(|h| h.kind == HitKind::Street).map(|h| h.label);
        assert_eq!(by("haupt").as_deref(), Some("Hauptstraße"));
        assert_eq!(by("muhlen").as_deref(), Some("Mühlenweg"));
        assert_eq!(by("hauptstrase").as_deref(), Some("Hauptstraße"), "one letter missing");
    }

    #[test]
    fn a_street_and_a_number_jump_to_the_house_and_the_title_says_where_it_matched() {
        let idx = index(true);
        let groups = ask(&idx, "hauptstr 12a", &Situation::default());
        let first = &groups[0].hits[0];
        assert_eq!((groups[0].title, first.kind, first.label.as_str(), first.id.as_str()), ("Häuser", HitKind::House, "Hauptstraße 12a", "h:a"));
        assert!(!first.marks.is_empty(), "the typed letters are marked");
        assert!(first.marks.iter().all(|&(s, e)| first.label.is_char_boundary(s) && first.label.is_char_boundary(e)));
    }

    #[test]
    fn nothing_typed_offers_the_recents_and_then_the_commands() {
        let idx = index(true);
        let none = ask(&idx, "  ", &Situation::default());
        assert_eq!(none.iter().map(|g| g.title).collect::<Vec<_>>(), ["Befehle"]);
        assert!(none[0].hits.iter().any(|h| h.id == "cmd:mark" && h.icon.is_some()));
        let mut recents = Recents::default();
        recents.push("h:a", 5);
        let with = ask(&idx, "", &Situation { recents, ..Situation::default() });
        assert_eq!(with[0].title, "Zuletzt");
        assert_eq!(with[0].hits[0].label, "Hauptstraße 12a");
        assert_eq!(with[1].title, "Befehle");
    }

    #[test]
    fn people_are_only_found_by_those_who_manage_them() {
        let idx = index(true);
        let name = world(Persona::Admin).personen[0].label.clone();
        let q = name.to_lowercase();
        let managers = ask(&idx, &q, &Situation { with_people: true, ..Situation::default() });
        let others = ask(&idx, &q, &Situation { with_people: false, ..Situation::default() });
        assert!(managers.iter().any(|g| g.title == "Personen"));
        assert!(!others.iter().any(|g| g.title == "Personen"));
    }

    #[test]
    fn a_command_is_found_by_its_keywords_and_nothing_is_an_empty_list() {
        let idx = index(true);
        let g = ask(&idx, "neues gebiet", &Situation::default());
        assert!(labels(&g).iter().any(|(t, l)| *t == "Befehle" && l.contains(&"Neues Gebiet zeichnen")));
        assert!(ask(&idx, "qqqqqqqq", &Situation::default()).is_empty());
    }

    #[test]
    fn one_kind_cannot_fill_the_card() {
        let w = world(Persona::Admin);
        let houses: Vec<House> = (1..=30).map(|n| house(&format!("n{n}"), "Hauptstraße", &n.to_string())).collect();
        let network = Network { segments: vec![seg("1#0", "Hauptstraße", [13.0, 51.0])], houses };
        let mut all = world_entries(&w, true);
        all.extend(field_entries(&FieldIndex::new(&network), &HashMap::new()));
        let groups = ask(&Index::build(all), "hauptstrasse", &Situation::default());
        assert!(groups.iter().all(|g| g.hits.len() <= PER_GROUP));
    }
}
