//! What the interface offers. The server decides every right; this is the same decision (`flyermap_identity::decide`) asked locally, so a button
//! that would be refused is not shown, and the sentence "du darfst hier nur ansehen" is always true. Nothing here grants anything.
use super::world::Gebiet;
use flyermap_identity::{decide, AccessSet, Action, AktionId, GebietId, GruppeId, Grant, OrgId, Resource, Role};

#[derive(Clone, Debug, PartialEq)]
pub struct Rights {
    set: AccessSet,
    org: OrgId,
    aktion: AktionId,
    /// Milliseconds since the epoch: grants that ran out are not counted.
    now: u64,
}

impl Rights {
    pub fn new(grants: Vec<Grant>, org: OrgId, aktion: AktionId, now: u64) -> Rights {
        Rights { set: AccessSet::new(grants), org, aktion, now }
    }

    /// Before the first answer of the server, and for a device without access: nothing is allowed.
    pub fn none() -> Rights {
        Rights::new(Vec::new(), OrgId::new(""), AktionId::new(""), 0)
    }

    fn allowed(&self, action: Action, resource: &Resource) -> bool {
        decide(&self.set, self.now, action, resource).is_allowed()
    }

    /// An action on the Aktion itself (rename, invite people, see the Studio).
    pub fn can_aktion(&self, action: Action) -> bool {
        self.allowed(action, &Resource::aktion(&self.org, &self.aktion))
    }

    /// An action in one Gebiet (mark it, draw on it, take it over).
    pub fn can_gebiet(&self, action: Action, gebiet: &Gebiet) -> bool {
        let gruppe = gebiet.gruppe.as_deref().map(GruppeId::new);
        let resource = Resource::gebiet(&self.org, &self.aktion, &GebietId::new(&gebiet.id), gebiet.art, gruppe.as_ref());
        self.allowed(action, &resource)
    }

    /// An action on a Gruppe (colour, members, new Gebiete for it).
    pub fn can_gruppe(&self, action: Action, gruppe: &str) -> bool {
        self.allowed(action, &Resource::gruppe(&self.org, &self.aktion, &GruppeId::new(gruppe)))
    }

    /// Is there any Gebiet this person may mark in? Without one the whole marking tool stays away.
    pub fn may_mark_somewhere(&self, gebiete: &[Gebiet]) -> bool {
        gebiete.iter().any(|g| self.can_gebiet(Action::Mark, g))
    }

    /// May the person draw (or change) Gebiete anywhere?
    pub fn may_draw_somewhere(&self, gebiete: &[Gebiet]) -> bool {
        self.can_aktion(Action::DrawArea) || gebiete.iter().any(|g| self.can_gebiet(Action::DrawArea, g))
    }

    /// The strongest role the person holds here, for the label under the name.
    pub fn strongest(&self) -> Option<Role> {
        self.set.active(self.now).map(|g| g.role).min()
    }

    pub fn role_label(&self) -> &'static str {
        match self.strongest() {
            Some(Role::Owner) => "Inhaber",
            Some(Role::Admin) => "Admin",
            Some(Role::Lead) => "Leitung",
            Some(Role::Member) => "Mitglied",
            Some(Role::Helper) => "Helfer",
            Some(Role::Viewer) => "Zuschauer",
            None => "Gast",
        }
    }
}

/// The German name of a role (lists of people and invitations).
pub fn role_name(role: Role) -> &'static str {
    match role {
        Role::Owner => "Inhaber",
        Role::Admin => "Admin",
        Role::Lead => "Leitung",
        Role::Member => "Mitglied",
        Role::Helper => "Helfer",
        Role::Viewer => "Zuschauer",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_identity::{Art, Scope};

    fn gebiet(id: &str, gruppe: &str) -> Gebiet {
        Gebiet {
            id: id.into(),
            name: id.into(),
            gruppe: Some(gruppe.into()),
            art: Art::Austeilen,
            ring: Vec::new(),
            writable: true,
            pack_version: None,
            color: "#000000".into(),
        }
    }

    fn rights(grants: Vec<Grant>) -> Rights {
        Rights::new(grants, OrgId::new("o"), AktionId::new("a"), 1_000)
    }

    fn scope_gruppe(g: &str) -> Scope {
        Scope::Gruppe { org: OrgId::new("o"), aktion: AktionId::new("a"), gruppe: GruppeId::new(g) }
    }

    #[test]
    fn a_member_marks_in_the_own_group_only() {
        let r = rights(vec![Grant::new(Role::Member, scope_gruppe("nord"))]);
        assert!(r.can_gebiet(Action::Mark, &gebiet("g1", "nord")));
        assert!(!r.can_gebiet(Action::Mark, &gebiet("g2", "sued")));
        assert!(!r.can_gebiet(Action::DrawArea, &gebiet("g1", "nord")), "a member does not draw");
        assert!(r.may_mark_somewhere(&[gebiet("g2", "sued"), gebiet("g1", "nord")]));
        assert!(!r.may_mark_somewhere(&[gebiet("g2", "sued")]));
        assert_eq!(r.role_label(), "Mitglied");
    }

    #[test]
    fn an_admin_does_everything_in_the_aktion_and_a_viewer_only_looks() {
        let admin = rights(vec![Grant::new(Role::Admin, Scope::Aktion { org: OrgId::new("o"), aktion: AktionId::new("a") })]);
        assert!(admin.can_aktion(Action::ManagePeople) && admin.can_gebiet(Action::DrawArea, &gebiet("g", "x")));
        let viewer = rights(vec![Grant::new(Role::Viewer, Scope::Aktion { org: OrgId::new("o"), aktion: AktionId::new("a") })]);
        assert!(viewer.can_gebiet(Action::Read, &gebiet("g", "x")));
        assert!(!viewer.can_gebiet(Action::Mark, &gebiet("g", "x")) && !viewer.can_aktion(Action::ManagePeople));
        assert!(!viewer.may_draw_somewhere(&[gebiet("g", "x")]));
    }

    #[test]
    fn nothing_before_the_server_answered_and_nothing_after_a_grant_ran_out() {
        assert!(!Rights::none().can_aktion(Action::Enter));
        let expired = rights(vec![Grant::new(Role::Member, scope_gruppe("nord")).until(500)]);
        assert!(!expired.can_gebiet(Action::Mark, &gebiet("g1", "nord")));
        assert_eq!(expired.role_label(), "Gast");
    }

    #[test]
    fn the_strongest_role_is_the_label() {
        let r = rights(vec![Grant::new(Role::Viewer, scope_gruppe("a")), Grant::new(Role::Lead, scope_gruppe("a"))]);
        assert_eq!(r.role_label(), "Leitung");
    }
}
