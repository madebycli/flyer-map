//! What the Studio lists: five tabs (Gebiete, Gruppen, Läufe, Personen, Zugänge), each a list of rows that open the same sheet a tap on the map would. Pure: world,
//! rights, progress and the time in, rows out. Who may see people and access is the rights' business; the screen only hides what the server would refuse.
use crate::{
    features::{live::model::chip, overview::model::percent_of},
    model::{role_name, Rights, Subject, World, ZugangKind},
    shell::StudioTab,
    sync::ago,
    ui::{fold::fold, IconName},
};
use flyermap_core::ProgressSnapshot;
use flyermap_identity::{Action, Art};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub subject: Subject,
    pub icon: IconName,
    pub title: String,
    pub detail: String,
    /// At the right: the progress of a Gebiet, how many are out in a Lauf.
    pub badge: Option<String>,
    /// The colour of the Gruppe the row belongs to.
    pub color: Option<String>,
}

/// The tabs this person gets: people and access only for those who manage people.
pub fn tabs(rights: &Rights) -> Vec<StudioTab> {
    let managers = rights.can_aktion(Action::ManagePeople);
    StudioTab::ALL.into_iter().filter(|t| managers || !matches!(t, StudioTab::Personen | StudioTab::Zugaenge)).collect()
}

pub fn label(tab: StudioTab) -> &'static str {
    match tab {
        StudioTab::Gebiete => "Gebiete",
        StudioTab::Gruppen => "Gruppen",
        StudioTab::Laeufe => "Läufe",
        StudioTab::Personen => "Personen",
        StudioTab::Zugaenge => "Zugänge",
    }
}

/// What the tab says when it has no rows.
pub fn empty_text(tab: StudioTab, not_served: bool) -> &'static str {
    if not_served {
        return "Diese Verbindung zeigt das noch nicht an.";
    }
    match tab {
        StudioTab::Gebiete => "Noch keine Gebiete.",
        StudioTab::Gruppen => "Noch keine Gruppen.",
        StudioTab::Laeufe => "Gerade ist niemand unterwegs.",
        StudioTab::Personen => "Noch keine Personen.",
        StudioTab::Zugaenge => "Keine Einladungen und keine angemeldeten Geräte.",
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// German order of names: accents folded, so "Östlich" stands among the Os.
fn by_name(rows: &mut [Row]) {
    rows.sort_by_cached_key(|r| fold(&r.title));
}

pub fn rows(tab: StudioTab, world: &World, progress: &HashMap<String, ProgressSnapshot>, now: u64) -> Vec<Row> {
    let mut out: Vec<Row> = match tab {
        StudioTab::Gebiete => world
            .gebiete
            .iter()
            .map(|g| {
                let gruppe = g.gruppe.as_deref().and_then(|id| world.gruppe(id)).map(|x| x.name.as_str());
                let art = if g.art == Art::Abholen { "Abholen" } else { "Austeilen" };
                Row {
                    subject: Subject::Gebiet(g.id.clone()),
                    icon: IconName::Polygon,
                    title: g.name.clone(),
                    detail: gruppe.map_or_else(|| art.to_string(), |n| format!("{n} · {art}")),
                    badge: progress.get(&g.id).filter(|p| p.total_houses > 0).map(|p| format!("{} %", percent_of(p))),
                    color: Some(g.color.clone()),
                }
            })
            .collect(),
        StudioTab::Gruppen => world
            .gruppen
            .iter()
            .map(|g| {
                let areas = world.gebiete.iter().filter(|x| x.gruppe.as_deref() == Some(g.id.as_str())).count();
                let people = world.personen.iter().filter(|p| p.gruppe.as_deref() == Some(g.id.as_str())).count();
                let mut detail = plural(areas, "Gebiet", "Gebiete");
                if people > 0 {
                    detail.push_str(&format!(" · {}", plural(people, "Person", "Personen")));
                }
                Row { subject: Subject::Gruppe(g.id.clone()), icon: IconName::Users, title: g.name.clone(), detail, badge: None, color: Some(g.color.clone()) }
            })
            .collect(),
        StudioTab::Laeufe => world
            .laeufe
            .iter()
            .map(|l| {
                let c = chip(l, world);
                Row { subject: Subject::Lauf(l.id.clone()), icon: IconName::Flag, title: c.title, detail: c.detail, badge: None, color: Some(c.color) }
            })
            .collect(),
        StudioTab::Personen => world
            .personen
            .iter()
            .map(|p| {
                let gruppe = p.gruppe.as_deref().and_then(|id| world.gruppe(id)).map(|g| g.name.as_str());
                let seen = format!("zuletzt {}", ago(p.last_seen, now));
                let detail = [Some(role_name(p.role)), gruppe, Some(seen.as_str())].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                let icon = if p.guest { IconName::Hand } else { IconName::Users };
                Row { subject: Subject::Person(p.id.clone()), icon, title: p.label.clone(), detail, badge: p.guest.then(|| "Gast".to_string()), color: None }
            })
            .collect(),
        StudioTab::Zugaenge => world
            .zugaenge
            .iter()
            .map(|z| {
                let invite = z.kind == ZugangKind::Einladung;
                let detail = if invite {
                    match z.max_uses {
                        Some(max) => format!("{} · {} von {max} genutzt", role_name(z.role), z.uses),
                        None => format!("{} · {}-mal genutzt", role_name(z.role), z.uses),
                    }
                } else {
                    format!("{} · angemeldetes Gerät", role_name(z.role))
                };
                Row {
                    subject: Subject::Zugang(z.id.clone()),
                    icon: if invite { IconName::Send } else { IconName::Lock },
                    title: z.label.clone(),
                    detail,
                    badge: None,
                    color: None,
                }
            })
            .collect(),
    };
    // the live ones keep the order the server gave (newest first); lists of names are sorted
    if tab != StudioTab::Laeufe {
        by_name(&mut out);
    }
    out
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
    fn only_those_who_manage_people_get_the_people_and_access_tabs() {
        assert_eq!(tabs(&rights(Persona::Admin)).len(), 5);
        let member = tabs(&rights(Persona::Member));
        assert_eq!(member, [StudioTab::Gebiete, StudioTab::Gruppen, StudioTab::Laeufe]);
        assert!(!tabs(&rights(Persona::Viewer)).contains(&StudioTab::Personen));
    }

    #[test]
    fn gebiete_stand_in_name_order_with_their_gruppe_and_progress() {
        let w = world(Persona::Admin);
        let rows = rows(StudioTab::Gebiete, &w, &HashMap::new(), NOW);
        assert_eq!(rows.len(), w.gebiete.len());
        let names: Vec<&str> = rows.iter().map(|r| r.title.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_by_key(|n| fold(n));
        assert_eq!(names, sorted);
        assert!(rows.iter().all(|r| r.detail.contains("Austeilen") && r.badge.is_none()), "no progress yet: no percentage");
        assert!(matches!(rows[0].subject, Subject::Gebiet(_)));
    }

    #[test]
    fn a_gruppe_counts_its_gebiete_and_people() {
        let w = world(Persona::Admin);
        let rows = rows(StudioTab::Gruppen, &w, &HashMap::new(), NOW);
        let nord = rows.iter().find(|r| r.title == "Gruppe Nord").unwrap();
        assert!(nord.detail.starts_with("2 Gebiete") || nord.detail.starts_with("1 Gebiet"), "{}", nord.detail);
    }

    #[test]
    fn laeufe_people_and_access_say_who_and_since_when() {
        let w = world(Persona::Admin);
        let l = rows(StudioTab::Laeufe, &w, &HashMap::new(), NOW);
        assert_eq!((l[0].title.as_str(), l[0].detail.as_str()), ("Ben +2", "Nordstadt · 3 Personen"));
        let p = rows(StudioTab::Personen, &w, &HashMap::new(), NOW);
        let guest = p.iter().find(|r| r.badge.as_deref() == Some("Gast")).unwrap();
        assert!(guest.detail.contains("zuletzt vor 4 h"), "{}", guest.detail);
        let z = rows(StudioTab::Zugaenge, &w, &HashMap::new(), NOW);
        assert!(z.iter().any(|r| r.detail.contains("2 von 5 genutzt")));
    }

    #[test]
    fn an_empty_tab_says_why() {
        assert_eq!(empty_text(StudioTab::Laeufe, false), "Gerade ist niemand unterwegs.");
        assert!(empty_text(StudioTab::Personen, true).contains("noch nicht"));
        for tab in StudioTab::ALL {
            assert!(!label(tab).is_empty() && !empty_text(tab, false).is_empty());
        }
    }
}
