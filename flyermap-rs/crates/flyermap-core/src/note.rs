//! Field notes: a quick flag and/or a short text on a street, a house or a whole Gebiet. `id` is the creation stamp (the note's identity),
//! `rev` the stamp of the latest edit (last writer wins).
use serde::{Deserialize, Serialize};

pub const NOTE_TEXT_MAX: usize = 500;

/// What a flag says in one tap. `Dog` and `Danger` are no longer offered but may sit in older notes: they are still read, shown and synced.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flag {
    Locked,
    Nope,
    Full,
    Again,
    Info,
    Dog,
    Danger,
}

impl Flag {
    /// The order of the picker; legacy flags last.
    pub const ALL: [Flag; 7] = [Flag::Locked, Flag::Nope, Flag::Full, Flag::Again, Flag::Info, Flag::Dog, Flag::Danger];
    pub const OFFERED: [Flag; 5] = [Flag::Locked, Flag::Nope, Flag::Full, Flag::Again, Flag::Info];

    pub fn as_str(self) -> &'static str {
        match self {
            Flag::Locked => "locked",
            Flag::Nope => "nope",
            Flag::Full => "full",
            Flag::Again => "again",
            Flag::Info => "info",
            Flag::Dog => "dog",
            Flag::Danger => "danger",
        }
    }
    pub fn parse(text: &str) -> Option<Flag> {
        Flag::ALL.into_iter().find(|f| f.as_str() == text)
    }
    pub fn label(self) -> &'static str {
        match self {
            Flag::Dog => "Hund",
            Flag::Locked => "Kein Zutritt",
            Flag::Nope => "Keine Werbung",
            Flag::Full => "Briefkasten voll",
            Flag::Again => "Nochmal kommen",
            Flag::Danger => "Gefahr",
            Flag::Info => "Hinweis",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub key: String,
    pub area: String,
    pub flag: Option<Flag>,
    pub text: String,
    pub rev: String,
    pub deleted: bool,
    pub by: String,
}

/// `s:`/`h:` for a street piece or a house, `a:<areaId>` for a whole Gebiet; 1 to 80 characters of `A-Za-z0-9#:._~@-` after the prefix.
pub fn is_note_key(key: &str) -> bool {
    let Some((prefix, id)) = key.split_at_checked(2) else { return false };
    matches!(prefix, "s:" | "h:" | "a:") && (1..=80).contains(&id.chars().count()) && id.chars().all(|c| c.is_ascii_alphanumeric() || "#:._~@-".contains(c))
}

fn is_control(c: char) -> bool {
    matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}')
}

/// Control characters out, whitespace trimmed, length capped (in UTF-16 units, as JavaScript counts): the same rule on device and server.
pub fn clean_text(value: &str) -> String {
    let kept: String = value.chars().filter(|c| !is_control(*c)).collect();
    let trimmed = kept.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
    let mut units = 0;
    trimmed
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= NOTE_TEXT_MAX
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_flags_and_text() {
        assert!(is_note_key("a:area_n") && is_note_key("s:12~3") && is_note_key("h:w9"));
        assert!(!is_note_key("x:1") && !is_note_key("a:") && !is_note_key("a"));
        assert_eq!(Flag::parse("dog"), Some(Flag::Dog));
        assert_eq!(Flag::parse("cat"), None);
        assert_eq!(clean_text("  hi\u{0007}\tthere \n"), "hi\tthere");
        assert_eq!(clean_text(&"x".repeat(600)).len(), 500);
        assert_eq!(clean_text(&"😀".repeat(300)).chars().count(), 250, "an emoji is two units, as in JavaScript");
    }
}
