//! The German words the search itself puts on entries and hits. Everything a person reads from this crate is here, in one place.
use crate::entry::{Art, Kind};

/// Words that find an entry by what it is: "gruppe nord" finds the Gruppe "Nord" before any street with that word.
pub(crate) const TAG_AREA: &str = "gebiet";
pub(crate) const TAG_GROUP: &str = "gruppe";
pub(crate) const TAG_PERSON: &str = "person";
pub(crate) const TAG_NOTE: &str = "notiz";

/// Words in front of a house number that mean nothing ("Hauptstraße Nr. 12").
pub(crate) const FILLER: [&str; 5] = ["nr", "no", "hnr", "nummer", "hausnummer"];

pub(crate) fn kind_subtitle(kind: Kind) -> &'static str {
    match kind {
        Kind::Command => "Befehl",
        Kind::Street => "Straße",
        Kind::House => "Haus",
        Kind::Area => "Gebiet",
        Kind::Group => "Gruppe",
        Kind::Person => "Person",
        Kind::Note => "Notiz",
    }
}

pub(crate) fn art_name(art: Art) -> &'static str {
    match art {
        Art::Austeilen => "austeilen",
        Art::Abholen => "abholen",
    }
}

pub(crate) fn house_count(count: usize) -> String {
    if count == 1 {
        "1 Haus".to_string()
    } else {
        format!("{count} Häuser")
    }
}

/// "Straße · Nordstadt": the line under a title, with the place it lies in when that is known.
pub(crate) fn with_place(base: &str, place: Option<&str>) -> String {
    match place {
        Some(place) => format!("{base} · {place}"),
        None => base.to_string(),
    }
}
