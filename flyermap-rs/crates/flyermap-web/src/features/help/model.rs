//! The help's vocabulary and its one rule: who sees which question, and which questions match a search.
use super::entries::ENTRIES;
use crate::ui::fold::matches_all_words;

/// The signed-in role, as far as the help cares.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HelpRole {
    #[default]
    Admin,
    TeamEditor,
    Viewer,
    Collector,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub q: &'static str,
    /// Extra search words that are not in the text.
    pub tags: &'static str,
    /// `None`: everybody.
    pub roles: Option<&'static [HelpRole]>,
    pub a: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Topic {
    pub title: &'static str,
    pub intro: &'static [&'static str],
}

impl Entry {
    pub fn is_for(&self, role: HelpRole) -> bool {
        self.roles.is_none_or(|roles| roles.contains(&role))
    }

    pub fn matches(&self, query: &str) -> bool {
        matches_all_words(
            query,
            &format!("{} {} {}", self.q, self.a.join(" "), self.tags),
        )
    }
}

/// The entries this role sees that contain every word of the query (all of them for a blank query), in their order.
pub fn shown(role: HelpRole, query: &str) -> Vec<Entry> {
    ENTRIES
        .iter()
        .filter(|e| e.is_for(role) && e.matches(query))
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_see_their_entries_only() {
        let admin = shown(HelpRole::Admin, "");
        let helper = shown(HelpRole::Collector, "");
        assert!(admin.iter().any(|e| e.q == "Wie lege ich ein Gebiet an?"));
        assert!(!helper.iter().any(|e| e.q == "Wie lege ich ein Gebiet an?"));
        assert!(helper
            .iter()
            .any(|e| e.q == "Wie übernehme ich ein Teilgebiet?"));
        assert!(!admin
            .iter()
            .any(|e| e.q == "Wie übernehme ich ein Teilgebiet?"));
        assert!(
            admin
                .iter()
                .chain(&helper)
                .any(|e| e.q == "Was bedeuten die Farben?"),
            "an entry without roles is for everybody"
        );
    }

    #[test]
    fn the_search_narrows_by_every_word_and_tags_count() {
        let all = shown(HelpRole::Admin, "").len();
        let lasso = shown(HelpRole::Admin, "lasso");
        assert!(!lasso.is_empty() && lasso.len() < all);
        assert!(shown(HelpRole::Admin, "LASSO finger")
            .iter()
            .all(|e| e.matches("lasso finger")));
        assert_eq!(
            shown(HelpRole::Admin, "brainrot").len(),
            1,
            "found by its tag"
        );
        assert!(shown(HelpRole::Admin, "xyzzy").is_empty());
    }

    #[test]
    fn umlauts_need_not_be_typed() {
        assert_eq!(
            shown(HelpRole::Admin, "ruckgangig").len(),
            shown(HelpRole::Admin, "rückgängig").len()
        );
        assert!(!shown(HelpRole::Admin, "ruckgangig").is_empty());
    }
}
