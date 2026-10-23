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
    pub const ALL: [HitKind; 7] = [HitKind::Command, HitKind::Gebiet, HitKind::Street, HitKind::House, HitKind::Gruppe, HitKind::Lauf, HitKind::Person];

    /// A stable word for storing (the recents survive a new version).
    pub fn code(self) -> &'static str {
        match self {
            HitKind::Command => "command",
            HitKind::Street => "street",
            HitKind::House => "house",
            HitKind::Gebiet => "gebiet",
            HitKind::Gruppe => "gruppe",
            HitKind::Lauf => "lauf",
            HitKind::Person => "person",
        }
    }

    pub fn from_code(code: &str) -> Option<HitKind> {
        HitKind::ALL.into_iter().find(|k| k.code() == code)
    }

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
    /// Character ranges of the label the typed words hit (set in bold).
    pub marks: Vec<(usize, usize)>,
}

/// Results of one kind under one heading ("Gebiete", "Befehle", "Zuletzt").
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResultGroup {
    pub title: &'static str,
    pub hits: Vec<Hit>,
}

/// Every hit of the groups, in the order the screen shows them (the order the arrow keys walk).
pub fn flat(groups: &[ResultGroup]) -> Vec<Hit> {
    groups.iter().flat_map(|g| g.hits.iter().cloned()).collect()
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

    #[test]
    fn every_kind_has_a_code_that_reads_back() {
        for kind in HitKind::ALL {
            assert_eq!(HitKind::from_code(kind.code()), Some(kind));
        }
        assert_eq!(HitKind::from_code("nope"), None);
    }

    #[test]
    fn the_groups_flatten_in_the_order_they_are_shown() {
        let hit = |id: &str| Hit { id: id.into(), kind: HitKind::Gebiet, label: id.into(), detail: String::new(), icon: None, marks: Vec::new() };
        let groups = [ResultGroup { title: "A", hits: vec![hit("1"), hit("2")] }, ResultGroup { title: "B", hits: vec![hit("3")] }];
        assert_eq!(flat(&groups).iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["1", "2", "3"]);
    }
}
