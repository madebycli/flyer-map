//! The search behind the bar until the search library (`flyermap-search`) exists: commands, then the names of Gebiete, Gruppen, Läufe and people;
//! every typed word must occur (accents folded). Streets and houses come from the engine once the map is wired. The bar only knows [`Hit`]s.
use super::commands::{suggestions, COMMANDS};
use crate::{
    model::World,
    ui::{fold::matches_all_words, Hit, HitKind},
};

/// At most this many results: the card scrolls, but nobody reads a hundred.
pub const LIMIT: usize = 40;

fn command_hit(c: &super::commands::Command) -> Hit {
    Hit { id: c.key.to_string(), kind: HitKind::Command, label: c.label.to_string(), detail: c.hint.to_string(), icon: Some(c.icon) }
}

fn plain(id: &str, kind: HitKind, label: String, detail: String) -> Hit {
    Hit { id: id.to_string(), kind, label, detail, icon: None }
}

/// With nothing typed: the commands. With text: commands that match, then Gebiete, Gruppen, Läufe and people, each in the order of the world.
pub fn find(world: &World, query: &str, studio_is_column: bool) -> Vec<Hit> {
    if query.trim().is_empty() {
        return suggestions(studio_is_column).into_iter().map(command_hit).collect();
    }
    let mut out: Vec<Hit> = COMMANDS.iter().filter(|c| c.matches(query)).map(command_hit).collect();
    for g in world.gebiete.iter().filter(|g| matches_all_words(query, &g.name)) {
        let detail = g.gruppe.as_deref().and_then(|id| world.gruppe(id)).map(|x| x.name.clone()).unwrap_or_default();
        out.push(plain(&g.id, HitKind::Gebiet, g.name.clone(), detail));
    }
    for g in world.gruppen.iter().filter(|g| matches_all_words(query, &g.name)) {
        out.push(plain(&g.id, HitKind::Gruppe, g.name.clone(), String::new()));
    }
    for l in &world.laeufe {
        let chip = crate::features::live::model::chip(l, world);
        if matches_all_words(query, &format!("{} {}", chip.title, chip.detail)) {
            out.push(plain(&l.id, HitKind::Lauf, chip.title, chip.detail));
        }
    }
    for p in world.personen.iter().filter(|p| matches_all_words(query, &p.label)) {
        out.push(plain(&p.id, HitKind::Person, p.label.clone(), crate::model::role_name(p.role).to_string()));
    }
    out.truncate(LIMIT);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    #[test]
    fn names_are_found_by_every_word_with_accents_folded() {
        let w = world(Persona::Admin);
        let kinds = |q: &str| find(&w, q, false).iter().map(|h| (h.kind, h.label.clone())).collect::<Vec<_>>();
        assert_eq!(kinds("nord"), [(HitKind::Gebiet, "Nordstadt".into()), (HitKind::Gruppe, "Gruppe Nord".into()), (HitKind::Lauf, "Ben +2".into())]);
        assert_eq!(kinds("muhlen"), [(HitKind::Gebiet, "Mühlenfeld".into())]);
        assert_eq!(kinds("anna"), [(HitKind::Person, "Anna".into())]);
        assert!(find(&w, "bahnhof", false).is_empty());
    }

    #[test]
    fn an_empty_field_offers_the_commands_and_a_typed_word_finds_them_too() {
        let w = world(Persona::Admin);
        assert_eq!(find(&w, "  ", false).len(), 4);
        assert_eq!(find(&w, "", true).len(), 3);
        let hits = find(&w, "einst", false);
        assert_eq!((hits[0].kind, hits[0].id.as_str()), (HitKind::Command, "settings"));
    }
}
