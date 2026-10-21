//! The rows of the menu (port of `menuGroups` in `src/v5/app/App.tsx`), ordered by use: what the day is about first, setting things up second,
//! the app itself last. Look, hand, diagnosis and the like are one level down in the settings. Pure: who sees which row is tested natively.
use crate::ui::IconName;

/// What a row leads to; the app decides what that means today.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuTarget {
    Overview,
    Team,
    Runs,
    Notes,
    Areas,
    Pickup,
    NextOpen,
    FitAll,
    Setup,
    Groups,
    Access,
    Templates,
    /// The organiser pages (a link in the React app).
    Admin,
    Settings,
    Help,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MenuRow {
    pub target: MenuTarget,
    pub icon: IconName,
    pub label: &'static str,
    pub hint: Option<&'static str>,
    pub badge: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MenuGroup {
    pub id: &'static str,
    pub title: Option<&'static str>,
    pub rows: Vec<MenuRow>,
}

/// Who is looking and what is going on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MenuContext {
    pub admin: bool,
    pub collection: bool,
    pub rooms_on: bool,
    pub may_mark: bool,
    pub can_edit_any: bool,
    pub may_create_pickups: bool,
    pub active_runs: u32,
    pub notes: u32,
}

fn row(target: MenuTarget, icon: IconName, label: &'static str, hint: Option<&'static str>) -> MenuRow {
    MenuRow { target, icon, label, hint, badge: None }
}

pub fn menu_groups(cx: MenuContext) -> Vec<MenuGroup> {
    use MenuTarget as T;
    let nonzero = |n: u32| (n > 0).then_some(n);
    let mut now = vec![
        row(T::Overview, IconName::Chart, "Übersicht", Some("Fortschritt, Gebiete, Synchronisierung")),
        row(T::Team, IconName::Users, "Team", Some("Wer ist unterwegs, letzte Änderungen")),
    ];
    if cx.rooms_on {
        now.push(MenuRow { badge: nonzero(cx.active_runs), ..row(T::Runs, IconName::Later, "Runs", Some("Gemeinsam losgehen")) });
    }
    now.push(MenuRow { badge: nonzero(cx.notes), ..row(T::Notes, IconName::Message, "Notizen", None) });

    let areas_hint = if cx.collection { "Teilgebiete übernehmen" } else { "Ansehen und bearbeiten" };
    let mut map = vec![row(T::Areas, IconName::Polygon, "Gebiete", Some(areas_hint))];
    if cx.collection && cx.may_create_pickups {
        map.push(row(T::Pickup, IconName::Flag, "Sonder-Marker", None));
    }
    if cx.may_mark {
        map.push(row(T::NextOpen, IconName::Route, "Nächste offene Straße", Some("Springt zur nächsten Straße mit Arbeit")));
    }
    map.push(row(T::FitAll, IconName::Fit, "Alles zeigen", None));

    let mut groups = vec![MenuGroup { id: "now", title: None, rows: now }, MenuGroup { id: "map", title: Some("Karte"), rows: map }];
    if cx.admin || cx.can_edit_any {
        let mut manage = Vec::new();
        if cx.admin && cx.collection {
            manage.push(row(T::Setup, IconName::Ruler, "Einrichten", Some("Sammelgebiet und Teilgebiete")));
        }
        if cx.admin && !cx.collection {
            manage.push(row(T::Groups, IconName::Flag, "Gruppen", Some("Gruppen und ihre Gebiete")));
        }
        if cx.admin {
            manage.push(row(T::Access, IconName::Lock, "Zugänge", Some("Links und Codes zum Mitmachen")));
        }
        if cx.can_edit_any && !cx.collection {
            manage.push(row(T::Templates, IconName::Upload, "Vorlagen", Some("Aktion laden oder speichern")));
        }
        if cx.admin {
            manage.push(row(T::Admin, IconName::Shield, "Verwaltung", Some("Alle Aktionen, Konten, Einstellungen der Organisation")));
        }
        groups.push(MenuGroup { id: "admin", title: Some("Verwalten"), rows: manage });
    }
    groups.push(MenuGroup {
        id: "app",
        title: Some("App"),
        rows: vec![row(T::Settings, IconName::Settings, "Einstellungen", Some("Darstellung, Hand, Karte")), row(T::Help, IconName::Help, "Hilfe", None)],
    });
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(groups: &[MenuGroup]) -> Vec<&'static str> {
        groups.iter().flat_map(|g| g.rows.iter().map(|r| r.label)).collect()
    }

    #[test]
    fn an_admin_handing_out_sees_groups_and_templates_but_no_setup() {
        let cx = MenuContext { admin: true, can_edit_any: true, may_mark: true, rooms_on: true, active_runs: 2, notes: 0, ..Default::default() };
        let groups = menu_groups(cx);
        assert_eq!(groups.iter().map(|g| g.id).collect::<Vec<_>>(), ["now", "map", "admin", "app"]);
        let l = labels(&groups);
        assert!(l.contains(&"Gruppen") && l.contains(&"Vorlagen") && l.contains(&"Verwaltung") && !l.contains(&"Einrichten"));
        let runs = groups[0].rows.iter().find(|r| r.target == MenuTarget::Runs).unwrap();
        assert_eq!(runs.badge, Some(2));
        assert_eq!(groups[0].rows.iter().find(|r| r.target == MenuTarget::Notes).unwrap().badge, None, "0 is no badge");
    }

    #[test]
    fn an_admin_collecting_sets_up_instead() {
        let cx = MenuContext { admin: true, collection: true, can_edit_any: true, may_create_pickups: true, ..Default::default() };
        let l = labels(&menu_groups(cx));
        assert!(l.contains(&"Einrichten") && l.contains(&"Sonder-Marker") && !l.contains(&"Gruppen") && !l.contains(&"Vorlagen"));
    }

    #[test]
    fn a_viewer_has_no_manage_group_and_settings_come_last() {
        let groups = menu_groups(MenuContext::default());
        assert_eq!(groups.iter().map(|g| g.id).collect::<Vec<_>>(), ["now", "map", "app"]);
        assert_eq!(labels(&groups).last(), Some(&"Hilfe"));
        assert!(!labels(&groups).contains(&"Nächste offene Straße"));
    }
}
