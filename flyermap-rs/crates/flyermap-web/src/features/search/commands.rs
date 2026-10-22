//! The commands of the bar: what used to be a menu. They are found like everything else (type a few letters) and offered when the field is empty.
//! Pure: a command is data; what it does is the app's business (`app::frame`).
use crate::ui::{fold::matches_all_words, IconName};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandId {
    Overview,
    Settings,
    Help,
    Studio,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Command {
    pub id: CommandId,
    /// The key the hit carries (stable, for the recents and the flows).
    pub key: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub icon: IconName,
    /// More words that find it.
    pub words: &'static str,
}

pub const COMMANDS: [Command; 4] = [
    Command {
        id: CommandId::Overview,
        key: "overview",
        label: "Übersicht",
        hint: "Fortschritt je Gebiet und Gruppe",
        icon: IconName::Chart,
        words: "fortschritt statistik prozent",
    },
    Command {
        id: CommandId::Studio,
        key: "studio",
        label: "Studio",
        hint: "Gruppen, Gebiete, Läufe, Personen, Zugänge",
        icon: IconName::Studio,
        words: "verwalten gruppen gebiete laeufe personen zugaenge",
    },
    Command {
        id: CommandId::Settings,
        key: "settings",
        label: "Einstellungen",
        hint: "Hell oder dunkel, Farbe, Bedienung",
        icon: IconName::Settings,
        words: "design farbe hand dunkel hell ton",
    },
    Command { id: CommandId::Help, key: "help", label: "Hilfe", hint: "Fragen und Antworten", icon: IconName::Help, words: "anleitung erklaerung" },
];

pub fn command(key: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|c| c.key == key)
}

impl Command {
    pub fn matches(&self, query: &str) -> bool {
        matches_all_words(query, &format!("{} {} {}", self.label, self.hint, self.words))
    }
}

/// The commands the field offers while it is empty (the Studio only where it is not already a column).
pub fn suggestions(studio_is_column: bool) -> Vec<&'static Command> {
    COMMANDS.iter().filter(|c| !(studio_is_column && c.id == CommandId::Studio)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_found_by_their_words() {
        let found = |q: &str| COMMANDS.iter().filter(|c| c.matches(q)).map(|c| c.key).collect::<Vec<_>>();
        assert_eq!(found("einst"), ["settings"]);
        assert_eq!(found("farbe"), ["settings"]);
        assert_eq!(found("gruppen"), ["studio"], "the hint of the Studio names them");
        assert_eq!(found("fortschr"), ["overview"]);
        assert!(found("xyz").is_empty());
    }

    #[test]
    fn on_a_wide_screen_the_studio_is_not_offered_as_it_is_already_there() {
        assert_eq!(suggestions(false).len(), 4);
        assert!(suggestions(true).iter().all(|c| c.id != CommandId::Studio));
        assert_eq!(command("help").map(|c| c.label), Some("Hilfe"));
    }
}
