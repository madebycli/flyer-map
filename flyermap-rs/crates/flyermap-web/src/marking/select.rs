//! Which keys a marking means: the route's street pieces with their houses (as the options say), plus the houses tapped one by one. Pure: the marking
//! index (built once per derivation) and the state in, keys out.
use super::{panel::RouteFacts, state::MarkState};
use crate::{engine::Route, field::index::Index};
use flyermap_core::Key;
use std::collections::HashSet;

/// The keys the confirm of Strecke would set, in order, without doubles.
pub fn route_keys(index: &Index, route: Option<&Route>, state: &MarkState) -> Vec<Key> {
    let street_keys = match route {
        Some(Route::Selected { segment_ids, .. }) => index.keys_for_segments(segment_ids.iter().map(String::as_str), state.with_houses, state.houses_only),
        _ => Vec::new(),
    };
    let mut seen: HashSet<Key> = street_keys.iter().cloned().collect();
    let mut keys = street_keys;
    for id in state.picked() {
        let key = Key::house(&id);
        if seen.insert(key.clone()) {
            keys.push(key);
        }
    }
    keys
}

/// What the panel says about the route.
pub fn route_facts(keys: &[Key], route: Option<&Route>) -> RouteFacts {
    let houses = keys.iter().filter(|k| k.as_str().starts_with("h:")).count();
    let (streets, meters) = match route {
        Some(Route::Selected { segment_ids, length, .. }) => (segment_ids.len(), *length),
        _ => (0, 0.0),
    };
    RouteFacts { streets, houses, meters, keys: keys.len() }
}

/// "12 Häuser · 3 Straßenstücke: Ausgeteilt".
pub fn applied_text(keys: &[&Key], status_label: &str) -> String {
    let houses = keys.iter().filter(|k| k.as_str().starts_with("h:")).count();
    let streets = keys.len() - houses;
    let mut parts = Vec::new();
    if houses > 0 {
        parts.push(if houses == 1 { "1 Haus".to_string() } else { format!("{houses} Häuser") });
    }
    if streets > 0 {
        parts.push(if streets == 1 { "1 Straßenstück".to_string() } else { format!("{streets} Straßenstücke") });
    }
    format!("{}: {status_label}", parts.join(" · "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        engine::{House, Network, Segment},
        marking::state::MarkAction,
    };

    fn seg(id: &str, houses: u32) -> Segment {
        Segment {
            id: id.into(),
            group: id.split('#').next().unwrap_or(id).into(),
            chunk: id.split('#').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0),
            name: Some("A".into()),
            length: 50.0,
            from: "n".into(),
            to: "m".into(),
            house_count: houses,
            visible: true,
            mid: [0.0, 0.0],
            start: [0.0, 0.0],
        }
    }

    fn index() -> Index {
        let house = |id: &str, parent: &str| House { id: id.into(), center: [0.0, 0.0], parent: Some(parent.into()), street_parent: None };
        Index::new(&Network { segments: vec![seg("1#0", 2), seg("2#0", 1)], houses: vec![house("a", "1#0"), house("b", "1#0"), house("c", "2#0")] })
    }

    fn selected(ids: &[&str]) -> Route {
        Route::Selected { segment_ids: ids.iter().map(|s| (*s).into()).collect(), length: 100.0, ambiguous: false }
    }

    fn names(keys: &[Key]) -> Vec<&str> {
        keys.iter().map(Key::as_str).collect()
    }

    #[test]
    fn a_route_takes_its_pieces_and_houses_and_the_houses_tapped_alone_without_doubles() {
        let mut s = MarkState::default();
        s.reduce(MarkAction::TapHouse("a".into()));
        s.reduce(MarkAction::TapHouse("z".into()));
        let keys = route_keys(&index(), Some(&selected(&["1#0"])), &s);
        assert_eq!(names(&keys), ["s:1#0", "h:a", "h:b", "h:z"], "a house already on the street is not added twice");
        let facts = route_facts(&keys, Some(&selected(&["1#0"])));
        assert_eq!((facts.streets, facts.houses, facts.keys), (1, 3, 4));
    }

    #[test]
    fn without_the_houses_option_only_the_street_pieces_come() {
        let mut s = MarkState::default();
        s.reduce(MarkAction::ToggleHouses);
        assert_eq!(names(&route_keys(&index(), Some(&selected(&["1#0", "2#0"])), &s)), ["s:1#0", "s:2#0"]);
        assert!(route_keys(&index(), Some(&Route::Disconnected), &s).is_empty());
        assert!(route_keys(&index(), None, &s).is_empty());
    }

    #[test]
    fn the_confirmation_says_what_was_marked() {
        let keys = [Key::house("1"), Key::house("2"), Key::segment("a")];
        let refs: Vec<&Key> = keys.iter().collect();
        assert_eq!(applied_text(&refs, "Ausgeteilt"), "2 Häuser · 1 Straßenstück: Ausgeteilt");
        assert_eq!(applied_text(&refs[..1], "Später"), "1 Haus: Später");
    }
}
