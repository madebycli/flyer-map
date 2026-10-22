//! A search result as the bar shows it. The search itself (engine, fake list) lives in a feature; the bar only shows what it is given.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HitKind {
    Street,
    House,
    Gebiet,
    Gruppe,
    Lauf,
    Person,
    Command,
}

impl HitKind {
    pub fn label(self) -> &'static str {
        match self {
            HitKind::Command => "Befehl",
            HitKind::Street => "Straße",
            HitKind::House => "Haus",
            HitKind::Gebiet => "Gebiet",
            HitKind::Gruppe => "Gruppe",
            HitKind::Lauf => "Lauf",
            HitKind::Person => "Person",
        }
    }

    pub fn icon(self) -> crate::ui::icon::IconName {
        use crate::ui::icon::IconName;
        match self {
            HitKind::Command => IconName::Chevron,
            HitKind::Street => IconName::Road,
            HitKind::House => IconName::House,
            HitKind::Gebiet => IconName::Polygon,
            HitKind::Gruppe => IconName::Users,
            HitKind::Lauf => IconName::Flag,
            HitKind::Person => IconName::Hand,
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
    /// Replaces the icon of the kind (commands carry their own).
    pub icon: Option<crate::ui::icon::IconName>,
}

/// The card is open while the field has focus: with nothing typed it offers suggestions, with text it shows what was found.
pub fn card_open(focused: bool) -> bool {
    focused
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_needs_focus_only() {
        assert!(card_open(true));
        assert!(!card_open(false));
    }
}
