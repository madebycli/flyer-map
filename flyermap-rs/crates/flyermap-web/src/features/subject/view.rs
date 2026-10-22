//! What the sheet of a subject says: its title, a few facts, the actions the person may take. Pure: world, rights and the time in, text out.
use crate::{
    model::{actions_for, role_name, Act, Gebiet, Rights, Subject, SubjectContext, World, ZugangKind},
    sync::ago,
    ui::IconName,
};
use flyermap_identity::Art;

#[derive(Clone, Debug, PartialEq)]
pub struct SubjectView {
    pub icon: IconName,
    pub title: String,
    pub facts: Vec<String>,
    pub acts: Vec<Act>,
    /// A colour that belongs to the subject (the Gruppe's), for the badge.
    pub color: Option<String>,
}

/// The icon, the words of an action and a longer sentence for the screen reader.
pub fn act_label(act: Act, art: Art) -> (&'static str, IconName) {
    match act {
        Act::Show => ("Auf der Karte zeigen", IconName::Fit),
        Act::SetStatus => ("Status setzen", IconName::Check),
        Act::WholeStreet => ("Ganze Straße", IconName::Road),
        Act::StartLauf => ("Lauf starten", IconName::Flag),
        Act::EndLauf => ("Lauf beenden", IconName::Exit),
        Act::Follow => ("Folgen", IconName::Eye),
        Act::Take if art == Art::Abholen => ("Übernehmen", IconName::Paw),
        Act::Take => ("Übernehmen", IconName::Plus),
        Act::DrawConnect => ("Gebiet anschließen", IconName::Polygon),
        Act::DrawExtend => ("Gebiet erweitern", IconName::Plus),
        Act::Split => ("Hauptgebiet teilen", IconName::Swap),
        Act::NewGebiet => ("Neues Gebiet", IconName::Polygon),
        Act::Members => ("Mitglieder", IconName::Users),
        Act::ChangeRole => ("Rolle ändern", IconName::Shield),
        Act::Remove => ("Entfernen", IconName::Trash),
        Act::Share => ("Code zeigen", IconName::Send),
        Act::Revoke => ("Widerrufen", IconName::Lock),
    }
}

fn minutes_since(then: Option<u64>, now: u64) -> Option<String> {
    let min = now.checked_sub(then?)? / 60_000;
    Some(if min < 1 { "seit gerade eben".into() } else if min < 90 { format!("seit {min} min") } else { format!("seit {} h", min / 60) })
}

fn expires_in(expires: Option<u64>, now: u64) -> String {
    match expires {
        None => "läuft nicht ab".into(),
        Some(t) if t <= now => "abgelaufen".into(),
        Some(t) => {
            let days = (t - now).div_ceil(86_400_000);
            if days <= 1 { "läuft heute oder morgen ab".into() } else { format!("läuft in {days} Tagen ab") }
        }
    }
}

fn gebiet_facts(g: &Gebiet, world: &World) -> Vec<String> {
    let mut facts = Vec::new();
    if let Some(gruppe) = g.gruppe.as_deref().and_then(|id| world.gruppe(id)) {
        facts.push(gruppe.name.clone());
    }
    facts.push(if g.art == Art::Abholen { "Abholen".into() } else { "Austeilen".into() });
    let n = world.laeufe_in(&g.id).count();
    if n > 0 {
        facts.push(if n == 1 { "1 Lauf".into() } else { format!("{n} Läufe") });
    }
    facts
}

/// `None` when the subject does not exist (any more).
pub fn describe(subject: &Subject, world: &World, rights: &Rights, gebiet_of_key: Option<&Gebiet>, now: u64) -> Option<SubjectView> {
    let acts = actions_for(subject, &SubjectContext { world, rights, gebiet_of_key });
    let view = |icon, title: String, facts: Vec<String>, color: Option<String>| Some(SubjectView { icon, title, facts, acts: acts.clone(), color });
    match subject {
        Subject::Gebiet(id) => {
            let g = world.gebiet(id)?;
            view(IconName::Polygon, g.name.clone(), gebiet_facts(g, world), Some(g.color.clone()))
        }
        Subject::Gruppe(id) => {
            let g = world.gruppe(id)?;
            let n = world.gebiete.iter().filter(|x| x.gruppe.as_deref() == Some(id)).count();
            view(IconName::Users, g.name.clone(), vec![if n == 1 { "1 Gebiet".into() } else { format!("{n} Gebiete") }], Some(g.color.clone()))
        }
        Subject::Lauf(id) => {
            let l = world.lauf(id)?;
            let place = world.gebiet(&l.gebiet).map_or("Gebiet", |g| g.name.as_str()).to_string();
            let people = if l.headcount == 1 { "1 Person".to_string() } else { format!("{} Personen", l.headcount) };
            let mut facts = vec![place, people];
            facts.extend(minutes_since(l.started_at, now));
            let color = l.gruppe.as_deref().and_then(|g| world.gruppe(g)).map(|g| g.color.clone());
            view(IconName::Flag, crate::features::live::model::chip(l, world).title, facts, color)
        }
        Subject::Person(id) => {
            let p = world.person(id)?;
            let mut facts = vec![role_name(p.role).to_string()];
            facts.extend(p.gruppe.as_deref().and_then(|g| world.gruppe(g)).map(|g| g.name.clone()));
            facts.push(if p.guest { "Gast ohne Konto".into() } else { "mit Konto".into() });
            facts.push(format!("zuletzt {}", ago(p.last_seen, now)));
            view(if p.guest { IconName::Hand } else { IconName::Users }, p.label.clone(), facts, None)
        }
        Subject::Zugang(id) => {
            let z = world.zugaenge.iter().find(|z| &z.id == id)?;
            let mut facts = vec![role_name(z.role).to_string()];
            if z.kind == ZugangKind::Einladung {
                facts.push(match z.max_uses {
                    Some(max) => format!("{} von {max} genutzt", z.uses),
                    None => format!("{}-mal genutzt", z.uses),
                });
                facts.push(expires_in(z.expires, now));
            } else {
                facts.push("angemeldetes Gerät".into());
            }
            view(if z.kind == ZugangKind::Einladung { IconName::Send } else { IconName::Lock }, z.label.clone(), facts, None)
        }
        // houses and streets: the sheet is built from the map's data (`features::subject::field`)
        Subject::Haus(_) | Subject::Strasse(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{grants, world, Persona, AKTION, ORG};
    use flyermap_identity::{AktionId, OrgId};

    const NOW: u64 = 1_800_000_000_000;

    fn rights(p: Persona) -> Rights {
        Rights::new(grants(p), OrgId::new(ORG), AktionId::new(AKTION), NOW)
    }

    #[test]
    fn a_gebiet_says_its_gruppe_and_its_laeufe() {
        let (w, r) = (world(Persona::Admin), rights(Persona::Admin));
        let v = describe(&Subject::Gebiet("nordstadt".into()), &w, &r, None, NOW).unwrap();
        assert_eq!((v.title.as_str(), v.facts.as_slice()), ("Nordstadt", ["Gruppe Nord".to_string(), "Austeilen".to_string(), "1 Lauf".to_string()].as_slice()));
        assert!(v.acts.contains(&Act::StartLauf) && v.acts.contains(&Act::DrawConnect));
        let viewer = describe(&Subject::Gebiet("nordstadt".into()), &w, &rights(Persona::Viewer), None, NOW).unwrap();
        assert_eq!(viewer.acts, [Act::Show], "a viewer may only look");
    }

    #[test]
    fn a_lauf_says_who_where_and_since_when() {
        let (w, r) = (world(Persona::Admin), rights(Persona::Admin));
        let v = describe(&Subject::Lauf("lauf-1".into()), &w, &r, None, NOW).unwrap();
        assert_eq!(v.title, "Ben +2");
        assert_eq!(v.facts, ["Nordstadt", "3 Personen", "seit 40 min"]);
        assert_eq!(v.acts, [Act::Follow, Act::EndLauf]);
    }

    #[test]
    fn a_person_and_an_invitation_state_their_facts_in_words() {
        let (w, r) = (world(Persona::Admin), rights(Persona::Admin));
        let p = describe(&Subject::Person("gast-7".into()), &w, &r, None, NOW).unwrap();
        assert_eq!(p.facts, ["Mitglied", "Gruppe Süd", "Gast ohne Konto", "zuletzt vor 4 h"]);
        let z = describe(&Subject::Zugang("einladung-1".into()), &w, &r, None, NOW).unwrap();
        assert_eq!(z.facts, ["Mitglied", "2 von 5 genutzt", "läuft in 3 Tagen ab"]);
        assert!(describe(&Subject::Person("nobody".into()), &w, &r, None, NOW).is_none());
    }

    #[test]
    fn every_action_has_words() {
        for act in [Act::Show, Act::StartLauf, Act::Take, Act::DrawConnect, Act::Split, Act::Share, Act::Revoke, Act::Follow] {
            assert!(!act_label(act, Art::Austeilen).0.is_empty());
        }
    }
}
