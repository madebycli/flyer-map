//! The search behind the bar for this slice: streets and addresses of a fixed list, every typed word must occur (accents folded). The real
//! search is the engine's (`flyermap-engine::search`, M5); it returns the same [`Hit`]s.
use crate::ui::{fold::matches_all_words, Hit, HitKind};

/// A street or an address that can be found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub id: String,
    pub kind: HitKind,
    pub label: String,
    /// The Gebiet it lies in.
    pub area: String,
}

/// At most this many results: the card scrolls, but nobody reads a hundred.
pub const LIMIT: usize = 40;

/// Streets first, then addresses; each in the list's order.
pub fn find(places: &[Place], query: &str) -> Vec<Hit> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let hit = |p: &Place| Hit {
        id: p.id.clone(),
        kind: p.kind,
        label: p.label.clone(),
        detail: p.area.clone(),
    };
    let matching = |kind: HitKind| {
        places
            .iter()
            .filter(move |p| p.kind == kind && matches_all_words(query, &p.label))
    };
    matching(HitKind::Street)
        .chain(matching(HitKind::House))
        .take(LIMIT)
        .map(hit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(id: &str, kind: HitKind, label: &str) -> Place {
        Place {
            id: id.into(),
            kind,
            label: label.into(),
            area: "Nordstadt".into(),
        }
    }

    #[test]
    fn streets_come_before_houses_and_all_words_count() {
        let places = [
            place("h1", HitKind::House, "Hauptstraße 12"),
            place("s1", HitKind::Street, "Hauptstraße"),
            place("s2", HitKind::Street, "Lindenweg"),
        ];
        let hits = find(&places, "haupt");
        assert_eq!(
            hits.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            ["s1", "h1"]
        );
        assert_eq!(find(&places, "hauptstrasse 12").len(), 1);
        assert!(find(&places, "  ").is_empty());
        assert!(find(&places, "bahnhof").is_empty());
    }
}
