//! The live strip's chips: who is out right now, one chip per Lauf. Pure: the world in, chips out.
use crate::model::{Lauf, World};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chip {
    /// The id of the Lauf (a tap follows it).
    pub id: String,
    /// One or two letters in the circle.
    pub initials: String,
    /// The colour of the Gruppe.
    pub color: String,
    /// Who: the names of the people, or the Gruppe.
    pub title: String,
    /// Where and how many: "Nordstadt · 3 Personen".
    pub detail: String,
}

/// Up to two letters: the first of the first two words.
pub fn initials(text: &str) -> String {
    text.split_whitespace().filter_map(|w| w.chars().next()).take(2).flat_map(char::to_uppercase).collect()
}

fn who(lauf: &Lauf, world: &World) -> String {
    let names: Vec<&str> = lauf.members.iter().map(|m| m.label.as_str()).collect();
    match names.as_slice() {
        [] => lauf.gruppe.as_deref().and_then(|g| world.gruppe(g)).map_or_else(|| "Lauf".to_string(), |g| g.name.clone()),
        [one] => (*one).to_string(),
        [first, second] if lauf.headcount <= 2 => format!("{first} und {second}"),
        [first, ..] => {
            let more = lauf.headcount.saturating_sub(1);
            format!("{first} +{more}")
        }
    }
}

pub fn chip(lauf: &Lauf, world: &World) -> Chip {
    let title = who(lauf, world);
    let place = world.gebiet(&lauf.gebiet).map_or("Gebiet", |g| g.name.as_str());
    let people = if lauf.headcount == 1 { "1 Person".to_string() } else { format!("{} Personen", lauf.headcount) };
    let color = lauf.gruppe.as_deref().and_then(|g| world.gruppe(g)).map_or_else(|| "#6c7f92".to_string(), |g| g.color.clone());
    Chip { id: lauf.id.clone(), initials: initials(&title), color, detail: format!("{place} · {people}"), title }
}

pub fn chips(world: &World) -> Vec<Chip> {
    world.laeufe.iter().map(|l| chip(l, world)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    #[test]
    fn initials_are_the_first_letters_of_two_words() {
        assert_eq!(initials("Gruppe Nord"), "GN");
        assert_eq!(initials("ben"), "B");
        assert_eq!(initials("Anna Lena Maria"), "AL");
        assert_eq!(initials(""), "");
    }

    #[test]
    fn a_chip_says_who_where_and_how_many() {
        let w = world(Persona::Admin);
        let c = chips(&w);
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].title.as_str(), c[0].detail.as_str()), ("Ben +2", "Nordstadt · 3 Personen"));
        assert_eq!(c[0].color, "#4f8fdc");
        assert_eq!((c[1].title.as_str(), c[1].detail.as_str()), ("Dario", "Hafenviertel · 2 Personen"));
    }

    #[test]
    fn without_names_the_gruppe_speaks() {
        let mut w = world(Persona::Admin);
        w.laeufe[0].members.clear();
        assert_eq!(chip(&w.laeufe[0], &w).title, "Gruppe Nord");
        w.laeufe[0].gruppe = None;
        assert_eq!(chip(&w.laeufe[0], &w).title, "Lauf");
    }
}
