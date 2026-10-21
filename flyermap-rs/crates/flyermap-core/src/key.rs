use serde::{Deserialize, Serialize};
use std::fmt;

/// A street piece (`s:<id>`) or a house (`h:<id>`): the stable key of a derived entity.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Key(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntityKind {
    Segment,
    House,
}

const MAX_WIRE_ID: usize = 80;

impl Key {
    pub fn new(text: impl Into<String>) -> Key {
        Key(text.into())
    }
    pub fn segment(id: &str) -> Key {
        Key(format!("s:{id}"))
    }
    pub fn house(id: &str) -> Key {
        Key(format!("h:{id}"))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn kind(&self) -> Option<EntityKind> {
        match self.0.as_bytes().get(..2)? {
            b"s:" => Some(EntityKind::Segment),
            b"h:" => Some(EntityKind::House),
            _ => None,
        }
    }
    /// The id without the `s:`/`h:` prefix.
    pub fn id(&self) -> &str {
        self.0.get(2..).unwrap_or("")
    }

    /// What the server accepts as a key: `s:` or `h:`, then 1 to 80 characters of `A-Za-z0-9#:._~@-`.
    pub fn is_wire_valid(&self) -> bool {
        let id = self.id();
        self.kind().is_some() && (1..=MAX_WIRE_ID).contains(&id.chars().count()) && id.chars().all(|c| c.is_ascii_alphanumeric() || "#:._~@-".contains(c))
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for Key {
    fn from(text: &str) -> Key {
        Key(text.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_ids() {
        assert_eq!(Key::segment("12~3").kind(), Some(EntityKind::Segment));
        assert_eq!(Key::house("w9").id(), "w9");
        assert_eq!(Key::new("x:1").kind(), None);
        assert_eq!(Key::new("s").id(), "");
    }

    #[test]
    fn the_wire_rule_is_the_servers() {
        assert!(Key::segment("123~4@5#6:7.8_9-a").is_wire_valid());
        assert!(!Key::new("s:").is_wire_valid());
        assert!(!Key::new("x:1").is_wire_valid());
        assert!(!Key::new("s:a b").is_wire_valid());
        assert!(!Key::new(format!("s:{}", "a".repeat(81))).is_wire_valid());
        assert!(Key::new(format!("h:{}", "a".repeat(80))).is_wire_valid());
        assert!(!Key::new("s:ä").is_wire_valid());
    }
}
