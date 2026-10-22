//! What the world itself can answer: the names of Gebiete, Gruppen, Läufe and people, and the commands. Every typed word must occur (accents folded).
//! Streets and addresses are the engine's (`engine.rs`). The functions are pure; `app::search` wraps them as providers.
use super::commands::{suggestions, Command, COMMANDS};
use crate::{
    model::World,
    ui::{fold::matches_all_words, Hit, HitKind},
};

fn command_hit(c: &Command) -> Hit {
    Hit { id: c.key.to_string(), kind: HitKind::Command, label: c.label.to_string(), detail: c.hint.to_string(), icon: Some(c.icon), marks: Vec::new() }
}

fn plain(id: &str, kind: HitKind, label: String, detail: String) -> Hit {
    Hit { id: id.to_string(), kind, label, detail, icon: None, marks: Vec::new() }
}

/// The commands that match the typed words.
pub fn commands(text: &str) -> Vec<Hit> {
    COMMANDS.iter().filter(|c| c.matches(text)).map(command_hit).collect()
}

/// The commands the field offers while it is empty (the Studio only where it is not already a column).
pub fn offered(studio_is_column: bool) -> Vec<Hit> {
    suggestions(studio_is_column).into_iter().map(command_hit).collect()
}

/// Gebiete, Gruppen, Läufe and people whose name has every typed word, each kind in the order of the world.
pub fn names(world: &World, text: &str) -> Vec<Hit> {
    let mut out = Vec::new();
    for g in world.gebiete.iter().filter(|g| matches_all_words(text, &g.name)) {
        let detail = g.gruppe.as_deref().and_then(|id| world.gruppe(id)).map(|x| x.name.clone()).unwrap_or_default();
        out.push(plain(&g.id, HitKind::Gebiet, g.name.clone(), detail));
    }
    for g in world.gruppen.iter().filter(|g| matches_all_words(text, &g.name)) {
        out.push(plain(&g.id, HitKind::Gruppe, g.name.clone(), String::new()));
    }
    for l in &world.laeufe {
        let chip = crate::features::live::model::chip(l, world);
        if matches_all_words(text, &format!("{} {}", chip.title, chip.detail)) {
            out.push(plain(&l.id, HitKind::Lauf, chip.title, chip.detail));
        }
    }
    for p in world.personen.iter().filter(|p| matches_all_words(text, &p.label)) {
        out.push(plain(&p.id, HitKind::Person, p.label.clone(), crate::model::role_name(p.role).to_string()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    #[test]
    fn names_are_found_by_every_word_with_accents_folded() {
        let w = world(Persona::Admin);
        let kinds = |q: &str| names(&w, q).iter().map(|h| (h.kind, h.label.clone())).collect::<Vec<_>>();
        assert_eq!(kinds("nord"), [(HitKind::Gebiet, "Nordstadt".into()), (HitKind::Gruppe, "Gruppe Nord".into()), (HitKind::Lauf, "Ben +2".into())]);
        assert_eq!(kinds("muhlen"), [(HitKind::Gebiet, "Mühlenfeld".into())]);
        assert_eq!(kinds("anna"), [(HitKind::Person, "Anna".into())]);
        assert!(names(&w, "bahnhof").is_empty());
    }

    #[test]
    fn the_commands_are_offered_and_found() {
        assert_eq!(offered(false).len(), 4);
        assert_eq!(offered(true).len(), 3, "the Studio is already a column");
        let hits = commands("einst");
        assert_eq!((hits[0].kind, hits[0].id.as_str()), (HitKind::Command, "settings"));
        assert!(commands("xyz").is_empty());
    }
}
