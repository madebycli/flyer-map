//! What a tap can mean and what may be done with it. There is no menu of everything: a Gebiet, a house, a street, a person, a Lauf opens a sheet
//! with *its* actions, and [`actions_for`] says which ones, from the rights. The words and icons belong to the screens (`features::subject`).
use super::{rights::Rights, world::{Gebiet, World}};
use flyermap_identity::{Action, Art};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Gebiet(String),
    /// A house, by the engine's id (without `h:`).
    Haus(String),
    /// A street piece (a junction-to-junction piece), by the engine's id of one of its chunks (without `s:`).
    Strasse(String),
    Gruppe(String),
    Person(String),
    Lauf(String),
    Zugang(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Fly the map there.
    Show,
    /// Set a status (the sheet shows the four statuses).
    SetStatus,
    /// Mark the whole street with its houses.
    WholeStreet,
    StartLauf,
    EndLauf,
    Follow,
    /// Take a Gebiet over to collect it (Abholen).
    Take,
    /// Draw a new Gebiet that joins this one's border.
    DrawConnect,
    /// Grow this Gebiet by a piece drawn on its border.
    DrawExtend,
    /// Cut this main area into pieces (Abholen).
    Split,
    NewGebiet,
    Members,
    ChangeRole,
    Remove,
    Share,
    Revoke,
}

pub struct SubjectContext<'a> {
    pub world: &'a World,
    pub rights: &'a Rights,
    /// For a house or a street: the Gebiet it lies in (the engine knows, the server judges).
    pub gebiet_of_key: Option<&'a Gebiet>,
}

/// The actions the person may take on `subject`, most important first. An empty list is possible (a viewer on a house): the sheet then
/// shows the facts only.
pub fn actions_for(subject: &Subject, ctx: &SubjectContext) -> Vec<Act> {
    let r = ctx.rights;
    let mut out = Vec::new();
    match subject {
        Subject::Gebiet(id) => {
            let Some(g) = ctx.world.gebiet(id) else { return out };
            out.push(Act::Show);
            match g.art {
                Art::Austeilen if r.can_gebiet(Action::StartRun, g) => out.push(Act::StartLauf),
                Art::Abholen if r.can_gebiet(Action::Collect, g) => out.push(Act::Take),
                _ => {}
            }
            if r.can_gebiet(Action::DrawArea, g) {
                out.push(Act::DrawConnect);
                out.push(Act::DrawExtend);
                if g.art == Art::Abholen {
                    out.push(Act::Split);
                }
            }
        }
        Subject::Haus(_) | Subject::Strasse(_) => {
            let writable = ctx.gebiet_of_key.is_some_and(|g| r.can_gebiet(Action::Mark, g));
            if writable {
                out.push(Act::SetStatus);
                if matches!(subject, Subject::Strasse(_)) {
                    out.push(Act::WholeStreet);
                }
            }
            if ctx.gebiet_of_key.is_some() {
                out.push(Act::Show);
            }
        }
        Subject::Gruppe(id) => {
            if r.can_gruppe(Action::DrawArea, id) {
                out.push(Act::NewGebiet);
            }
            if r.can_gruppe(Action::ManageGroup, id) {
                out.push(Act::Members);
            }
        }
        Subject::Person(_) => {
            if r.can_aktion(Action::ManagePeople) {
                out.push(Act::ChangeRole);
                out.push(Act::Remove);
            }
        }
        Subject::Lauf(id) => {
            out.push(Act::Follow);
            let gebiet = ctx.world.lauf(id).and_then(|l| ctx.world.gebiet(&l.gebiet));
            if gebiet.is_some_and(|g| r.can_gebiet(Action::StartRun, g)) {
                out.push(Act::EndLauf);
            }
        }
        Subject::Zugang(_) => {
            if r.can_aktion(Action::ManagePeople) {
                out.push(Act::Share);
                out.push(Act::Revoke);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::world::{Aktion, Basemap, Lauf, Me};
    use flyermap_identity::{AktionId, Grant, GruppeId, OrgId, Role, Scope};

    fn gebiet(id: &str, gruppe: &str, art: Art) -> Gebiet {
        Gebiet { id: id.into(), name: id.into(), gruppe: Some(gruppe.into()), art, ring: Vec::new(), writable: true, pack_version: None, color: "#000".into() }
    }

    fn world() -> World {
        World {
            aktion: Aktion { id: "a".into(), name: "A".into(), art: Art::Austeilen },
            me: Me::default(),
            gruppen: Vec::new(),
            gebiete: vec![gebiet("g1", "nord", Art::Austeilen), gebiet("g2", "sued", Art::Austeilen), gebiet("p1", "x", Art::Abholen)],
            context: Vec::new(),
            laeufe: vec![Lauf { id: "l1".into(), gebiet: "g1".into(), gruppe: None, headcount: 2, members: Vec::new(), started_at: None, houses_done: None }],
            personen: Vec::new(),
            zugaenge: Vec::new(),
            basemap: Basemap::default(),
        }
    }

    fn rights(role: Role, scope: Scope) -> Rights {
        Rights::new(vec![Grant::new(role, scope)], OrgId::new("o"), AktionId::new("a"), 1)
    }

    fn aktion_scope() -> Scope {
        Scope::Aktion { org: OrgId::new("o"), aktion: AktionId::new("a") }
    }

    #[test]
    fn a_member_sees_the_actions_of_the_own_group_only() {
        let w = world();
        let r = rights(Role::Member, Scope::Gruppe { org: OrgId::new("o"), aktion: AktionId::new("a"), gruppe: GruppeId::new("nord") });
        let ctx = |g: Option<&Gebiet>| SubjectContext { world: &w, rights: &r, gebiet_of_key: g };
        assert_eq!(actions_for(&Subject::Gebiet("g1".into()), &ctx(None)), [Act::Show]);
        assert_eq!(actions_for(&Subject::Strasse("1#0".into()), &ctx(w.gebiet("g1"))), [Act::SetStatus, Act::WholeStreet, Act::Show]);
        assert_eq!(actions_for(&Subject::Haus("h".into()), &ctx(w.gebiet("g2"))), [Act::Show], "a house in somebody else's Gebiet: look only");
        assert!(actions_for(&Subject::Person("p".into()), &ctx(None)).is_empty());
    }

    #[test]
    fn an_admin_gets_drawing_runs_and_people() {
        let w = world();
        let r = rights(Role::Admin, aktion_scope());
        let ctx = SubjectContext { world: &w, rights: &r, gebiet_of_key: None };
        assert_eq!(actions_for(&Subject::Gebiet("g1".into()), &ctx), [Act::Show, Act::StartLauf, Act::DrawConnect, Act::DrawExtend]);
        assert_eq!(actions_for(&Subject::Gebiet("p1".into()), &ctx), [Act::Show, Act::Take, Act::DrawConnect, Act::DrawExtend, Act::Split]);
        assert_eq!(actions_for(&Subject::Lauf("l1".into()), &ctx), [Act::Follow, Act::EndLauf]);
        assert_eq!(actions_for(&Subject::Person("p".into()), &ctx), [Act::ChangeRole, Act::Remove]);
        assert_eq!(actions_for(&Subject::Zugang("z".into()), &ctx), [Act::Share, Act::Revoke]);
    }

    #[test]
    fn a_viewer_may_follow_but_nothing_else() {
        let w = world();
        let r = rights(Role::Viewer, aktion_scope());
        let ctx = SubjectContext { world: &w, rights: &r, gebiet_of_key: w.gebiet("g1") };
        assert_eq!(actions_for(&Subject::Lauf("l1".into()), &ctx), [Act::Follow]);
        assert_eq!(actions_for(&Subject::Strasse("s".into()), &ctx), [Act::Show]);
        assert_eq!(actions_for(&Subject::Gebiet("g1".into()), &ctx), [Act::Show]);
        assert!(actions_for(&Subject::Gebiet("nope".into()), &ctx).is_empty());
    }
}
