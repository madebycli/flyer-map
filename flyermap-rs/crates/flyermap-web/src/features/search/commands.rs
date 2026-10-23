//! The commands of the bar: what used to be a menu. They are entries of the search like everything else (type a few letters), and the ones that matter most
//! are offered while the field is empty. Pure: a command is data; what it does is the app's business (`app::search`). What the person may do decides
//! whether a command is found at all (the screen only mirrors the rights; the server still decides).
use crate::ui::IconName;
use flyermap_search::{Command as SearchCommand, Entry, Id};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandId {
    Mark,
    NewGebiet,
    Overview,
    Studio,
    Locate,
    Settings,
    Help,
}

/// What decides whether a command is offered.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Avail {
    /// The Studio is a column already (from 900 px).
    pub wide: bool,
    pub may_mark: bool,
    pub may_draw: bool,
}

pub struct Spec {
    pub id: CommandId,
    pub key: &'static str,
    pub label: &'static str,
    pub icon: IconName,
    /// More words that find it.
    pub keywords: &'static [&'static str],
    /// Higher is offered first while nothing is typed.
    pub priority: u8,
}

pub const SPECS: [Spec; 7] = [
    Spec {
        id: CommandId::Mark,
        key: "cmd:mark",
        label: "Markieren",
        icon: IconName::Tap,
        keywords: &["stempeln", "strecke", "wischen", "lasso", "starten", "los"],
        priority: 95,
    },
    Spec {
        id: CommandId::NewGebiet,
        key: "cmd:new-gebiet",
        label: "Neues Gebiet zeichnen",
        icon: IconName::Polygon,
        keywords: &["neu", "anlegen", "gebiet", "zeichnen", "polygon", "grenze"],
        priority: 90,
    },
    Spec {
        id: CommandId::Overview,
        key: "cmd:overview",
        label: "Übersicht",
        icon: IconName::Chart,
        keywords: &["fortschritt", "statistik", "prozent", "stand"],
        priority: 80,
    },
    Spec {
        id: CommandId::Studio,
        key: "cmd:studio",
        label: "Studio",
        icon: IconName::Studio,
        keywords: &["verwalten", "gruppen", "gebiete", "läufe", "personen", "zugänge", "einladen"],
        priority: 70,
    },
    Spec {
        id: CommandId::Locate,
        key: "cmd:locate",
        label: "Mein Standort",
        icon: IconName::Locate,
        keywords: &["gps", "position", "wo", "bin", "ich"],
        priority: 50,
    },
    Spec {
        id: CommandId::Settings,
        key: "cmd:settings",
        label: "Einstellungen",
        icon: IconName::Settings,
        keywords: &["design", "farbe", "hand", "dunkel", "hell", "ton"],
        priority: 40,
    },
    Spec { id: CommandId::Help, key: "cmd:help", label: "Hilfe", icon: IconName::Help, keywords: &["anleitung", "erklärung", "fragen"], priority: 30 },
];

pub fn spec_of_key(key: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.key == key)
}

fn allowed(id: CommandId, a: Avail) -> bool {
    match id {
        CommandId::Mark => a.may_mark,
        CommandId::NewGebiet => a.may_draw,
        CommandId::Studio => !a.wide,
        CommandId::Overview | CommandId::Locate | CommandId::Settings | CommandId::Help => true,
    }
}

/// The command entries for the index, with `allowed` set from what the person may do.
pub fn entries(a: Avail) -> Vec<Entry> {
    SPECS
        .iter()
        .map(|s| {
            Entry::Command(SearchCommand {
                id: Id::new(s.key),
                label: s.label.to_string(),
                keywords: s.keywords.iter().map(|k| k.to_string()).collect(),
                allowed: allowed(s.id, a),
                priority: s.priority,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_search::Entry as E;

    fn allowed_keys(a: Avail) -> Vec<&'static str> {
        let on: Vec<String> = entries(a).into_iter().filter_map(|e| if let E::Command(c) = e { c.allowed.then(|| c.id.to_string()) } else { None }).collect();
        SPECS.iter().filter(|s| on.iter().any(|k| k == s.key)).map(|s| s.key).collect()
    }

    #[test]
    fn what_a_person_may_not_do_is_not_offered() {
        let viewer = allowed_keys(Avail { wide: false, may_mark: false, may_draw: false });
        assert!(!viewer.contains(&"cmd:mark") && !viewer.contains(&"cmd:new-gebiet"));
        let admin = allowed_keys(Avail { wide: false, may_mark: true, may_draw: true });
        assert!(admin.contains(&"cmd:mark") && admin.contains(&"cmd:new-gebiet"));
    }

    #[test]
    fn the_studio_is_not_offered_where_it_is_already_a_column() {
        assert!(allowed_keys(Avail { wide: false, ..Avail::default() }).contains(&"cmd:studio"));
        assert!(!allowed_keys(Avail { wide: true, ..Avail::default() }).contains(&"cmd:studio"));
    }

    #[test]
    fn every_key_is_unique_and_found_again() {
        for s in &SPECS {
            assert_eq!(spec_of_key(s.key).map(|x| x.id), Some(s.id));
        }
        let mut keys: Vec<&str> = SPECS.iter().map(|s| s.key).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), SPECS.len());
    }
}
