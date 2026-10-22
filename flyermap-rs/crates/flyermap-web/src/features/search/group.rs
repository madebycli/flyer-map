//! Hits under headings. A heading per kind, in a fixed order (commands first, then what is on the map, then people), a cap per kind so one kind cannot
//! push the others off the card, and a typed number puts houses before streets (somebody who types "12" wants an address). Pure.
use crate::ui::{Hit, HitKind, ResultGroup};

/// The kind, its heading and how many it may show.
const KINDS: [(HitKind, &str, usize); 7] = [
    (HitKind::Command, "Befehle", 4),
    (HitKind::Gebiet, "Gebiete", 5),
    (HitKind::Street, "Straßen", 6),
    (HitKind::House, "Häuser", 6),
    (HitKind::Gruppe, "Gruppen", 4),
    (HitKind::Lauf, "Läufe", 4),
    (HitKind::Person, "Personen", 5),
];

/// Whether the typed text has a digit in it.
pub fn has_number(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_digit())
}

/// `hits` (in the order the providers gave them) as groups. Empty groups are left out.
pub fn grouped(hits: Vec<Hit>, text: &str) -> Vec<ResultGroup> {
    let mut order = KINDS.to_vec();
    if has_number(text) {
        let (streets, houses) = (2, 3);
        order.swap(streets, houses);
    }
    order
        .into_iter()
        .filter_map(|(kind, title, cap)| {
            let mine: Vec<Hit> = hits.iter().filter(|h| h.kind == kind).take(cap).cloned().collect();
            (!mine.is_empty()).then_some(ResultGroup { title, hits: mine })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(kind: HitKind, id: &str) -> Hit {
        Hit { id: id.into(), kind, label: id.into(), detail: String::new(), icon: None, marks: Vec::new() }
    }

    fn titles(groups: &[ResultGroup]) -> Vec<&str> {
        groups.iter().map(|g| g.title).collect()
    }

    #[test]
    fn kinds_stand_in_a_fixed_order_whatever_order_the_hits_came_in() {
        let hits = vec![hit(HitKind::Person, "p"), hit(HitKind::Street, "s"), hit(HitKind::Command, "c"), hit(HitKind::Gebiet, "g")];
        assert_eq!(titles(&grouped(hits, "x")), ["Befehle", "Gebiete", "Straßen", "Personen"]);
    }

    #[test]
    fn a_typed_number_puts_houses_before_streets() {
        let hits = vec![hit(HitKind::Street, "s"), hit(HitKind::House, "h")];
        assert_eq!(titles(&grouped(hits.clone(), "haupt 12")), ["Häuser", "Straßen"]);
        assert_eq!(titles(&grouped(hits, "haupt")), ["Straßen", "Häuser"]);
    }

    #[test]
    fn a_kind_shows_only_so_many_and_keeps_the_best_first() {
        let hits: Vec<Hit> = (0..9).map(|i| hit(HitKind::House, &format!("h{i}"))).collect();
        let groups = grouped(hits, "x");
        assert_eq!(groups[0].hits.len(), 6);
        assert_eq!(groups[0].hits[0].id, "h0");
        assert!(grouped(Vec::new(), "x").is_empty());
    }
}
