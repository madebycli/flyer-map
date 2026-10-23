//! From a finished drawing to what is stored: the new Gebiet with the name and the Gruppe the person chose, and every neighbour that changed with it (it keeps
//! its name, its Gruppe and its kind and only gets the new ring). One list, saved in one step, so no moment exists in which two Gebiete leave a gap or overlap.
use super::{state::Kind, verdict::Ready};
use crate::{backend::GebietDraft, model::Gebiet};
use flyermap_identity::Art;

/// `gebiete` are in the order the drawing's [`super::verdict::Areas`] were made from.
pub fn drafts(ready: &Ready, gebiete: &[Gebiet], name: &str, gruppe: Option<&str>, art: Art) -> Vec<GebietDraft> {
    let mut out = Vec::new();
    if ready.creates {
        out.push(GebietDraft { id: None, name: name.trim().to_string(), gruppe: gruppe.map(str::to_string), art, ring: ready.ring.clone() });
    }
    for (i, ring) in &ready.changed {
        if let Some(g) = gebiete.get(*i) {
            out.push(GebietDraft { id: Some(g.id.clone()), name: g.name.clone(), gruppe: g.gruppe.clone(), art: g.art, ring: ring.clone() });
        }
    }
    out
}

/// "Neues Gebiet 3": the first number that no Gebiet has yet ("Teilgebiet n" when a main area is cut).
pub fn suggest_name(gebiete: &[Gebiet], kind: Kind) -> String {
    let stem = if kind == Kind::Split { "Teilgebiet" } else { "Neues Gebiet" };
    (1..).map(|n| format!("{stem} {n}")).find(|candidate| !gebiete.iter().any(|g| g.name.eq_ignore_ascii_case(candidate))).unwrap_or_else(|| stem.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gebiet(id: &str, name: &str, gruppe: Option<&str>) -> Gebiet {
        Gebiet {
            id: id.into(),
            name: name.into(),
            gruppe: gruppe.map(str::to_string),
            art: Art::Austeilen,
            ring: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]],
            writable: true,
            pack_version: Some(2),
            color: "#000".into(),
        }
    }

    fn ready(creates: bool, changed: Vec<(usize, Vec<[f64; 2]>)>) -> Ready {
        Ready { kind: Kind::Connect, ring: vec![[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 5.0]], creates, changed, size: String::new() }
    }

    #[test]
    fn a_new_gebiet_comes_with_its_neighbour_that_got_corners() {
        let world = [gebiet("a", "Altstadt", Some("nord")), gebiet("b", "Hafen", None)];
        let neighbour = vec![[0.0, 0.0], [0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]];
        let list = drafts(&ready(true, vec![(0, neighbour.clone())]), &world, "  Parkviertel ", Some("sued"), Art::Austeilen);
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].id.as_deref(), list[0].name.as_str(), list[0].gruppe.as_deref()), (None, "Parkviertel", Some("sued")));
        assert_eq!((list[1].id.as_deref(), list[1].name.as_str(), list[1].gruppe.as_deref()), (Some("a"), "Altstadt", Some("nord")));
        assert_eq!(list[1].ring, neighbour);
    }

    #[test]
    fn growing_a_gebiet_changes_only_its_ring() {
        let world = [gebiet("a", "Altstadt", Some("nord"))];
        let list = drafts(&ready(false, vec![(0, vec![[9.0, 9.0], [9.5, 9.0], [9.0, 9.5], [9.0, 9.0]])]), &world, "ignored", None, Art::Austeilen);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id.as_deref(), list[0].name.as_str()), (Some("a"), "Altstadt"));
    }

    #[test]
    fn the_suggested_name_is_the_first_free_number() {
        let world = [gebiet("a", "Neues Gebiet 1", None), gebiet("b", "neues gebiet 2", None)];
        assert_eq!(suggest_name(&world, Kind::Free), "Neues Gebiet 3");
        assert_eq!(suggest_name(&[], Kind::Split), "Teilgebiet 1");
    }
}
