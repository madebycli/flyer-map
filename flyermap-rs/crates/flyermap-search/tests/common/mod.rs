//! One small town for all the integration tests: streets with houses, Gebiete, a Gruppe, people, a note and commands.
#![allow(dead_code)]
use flyermap_search::*;

pub fn at(lng: f64, lat: f64) -> Point {
    Point::new(lng, lat)
}

pub fn street(id: &str, name: &str, center: Point, area: Option<&str>) -> Entry {
    Entry::Street(Street { id: id.into(), name: name.into(), pieces: vec![format!("{id}/1").into()], center, area: area.map(Id::from) })
}

pub fn house(street: &str, number: &str, position: Point, area: Option<&str>) -> Entry {
    Entry::House(House { id: format!("h:{street}:{number}").into(), street: street.into(), number: number.into(), position, area: area.map(Id::from) })
}

pub fn command(id: &str, label: &str, keywords: &[&str], allowed: bool, priority: u8) -> Entry {
    Entry::Command(Command { id: id.into(), label: label.into(), keywords: keywords.iter().map(|k| k.to_string()).collect(), allowed, priority })
}

pub const NORTH: (f64, f64) = (13.40, 52.54);
pub const SOUTH: (f64, f64) = (13.40, 52.48);

pub fn town() -> Vec<Entry> {
    let (north, south) = (at(NORTH.0, NORTH.1), at(SOUTH.0, SOUTH.1));
    let mut all = vec![
        Entry::Area(Area { id: "a:nord".into(), name: "Nordstadt".into(), art: Art::Austeilen, center: Some(north) }),
        Entry::Area(Area { id: "a:sued".into(), name: "Südviertel".into(), art: Art::Abholen, center: Some(south) }),
        Entry::Group(Group { id: "g:nord".into(), name: "Gruppe Nord".into() }),
        Entry::Person(Person { id: "p:juergen".into(), name: "Jürgen Müller".into() }),
        Entry::Person(Person { id: "p:anna".into(), name: "Anna Schmidt".into() }),
        street("s:haupt", "Hauptstraße", north, Some("a:nord")),
        street("s:bahnhof", "Am Hauptbahnhof", south, Some("a:sued")),
        street("s:mueller", "Müllerstraße", south, Some("a:sued")),
        street("s:eschenbach", "Dr.-Eschenbach-Str.", north, Some("a:nord")),
        street("s:juni", "Straße des 17. Juni", south, Some("a:sued")),
        street("s:bahn-n", "Bahnhofstraße", north, Some("a:nord")),
        street("s:bahn-s", "Bahnhofstraße", south, Some("a:sued")),
        Entry::Note(Note {
            id: "n:1".into(),
            text: "Klingel kaputt, Hund im Garten".into(),
            key: "h:Hauptstraße:12".into(),
            position: Some(north),
            area: Some("a:nord".into()),
        }),
        command("c:new-area", "Neues Gebiet", &["neu", "anlegen"], true, 90),
        command("c:run", "Lauf starten", &["los"], true, 80),
        command("c:delete-group", "Gruppe löschen", &["entfernen"], false, 10),
    ];
    for number in ["1", "2", "10", "12", "12a", "12b", "12-14", "14", "20"] {
        all.push(house("Hauptstraße", number, north, Some("a:nord")));
    }
    for number in ["12", "30"] {
        all.push(house("Bahnhofstraße", number, south, Some("a:sued")));
    }
    all
}

pub fn index() -> Index {
    Index::build(town())
}

/// The ids of the hits in order.
pub fn ids(results: &Results) -> Vec<String> {
    results.hits.iter().map(|h| h.entry.id().to_string()).collect()
}

pub fn search(index: &Index, text: &str) -> Results {
    index.search(&Query::new(text))
}

/// The titles of the hits in order.
pub fn titles(results: &Results) -> Vec<String> {
    results.hits.iter().map(|h| h.title.clone()).collect()
}
