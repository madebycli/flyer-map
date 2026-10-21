//! A search result as the bar shows it. The search itself (engine, fake list) lives in a feature; the bar only shows what it is given.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HitKind {
    Street,
    House,
}

impl HitKind {
    pub fn label(self) -> &'static str {
        match self {
            HitKind::Street => "Straße",
            HitKind::House => "Haus",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hit {
    pub id: String,
    pub kind: HitKind,
    pub label: String,
    /// The Gebiet or the house number range, right-aligned.
    pub detail: String,
}

/// The card is open while the field has focus and something non-blank is typed.
pub fn card_open(focused: bool, query: &str) -> bool {
    focused && !query.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_needs_focus_and_text() {
        assert!(card_open(true, "haupt"));
        assert!(!card_open(true, "   "));
        assert!(!card_open(false, "haupt"));
    }
}
