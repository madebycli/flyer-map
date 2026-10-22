//! The rights model as scenarios (one per role and attack) and as properties over random grant sets (fixed seed).
use flyermap_identity::{
    decide, may_enter, may_grant, AccessSet, Action, AktionId, Art, Capability, Decision, Denial, GebietId, Grant, GruppeId, OrgId, Resource, Role, Scope,
};

fn org() -> OrgId {
    OrgId::new("org")
}
fn aktion(n: &str) -> AktionId {
    AktionId::new(n)
}
fn gruppe(n: &str) -> GruppeId {
    GruppeId::new(n)
}
fn gebiet(n: &str) -> GebietId {
    GebietId::new(n)
}
fn at_org() -> Scope {
    Scope::Organisation { org: org() }
}
fn at_aktion(a: &str) -> Scope {
    Scope::Aktion { org: org(), aktion: aktion(a) }
}
fn at_gruppe(a: &str, g: &str) -> Scope {
    Scope::Gruppe { org: org(), aktion: aktion(a), gruppe: gruppe(g) }
}
fn at_gebiet(a: &str, x: &str) -> Scope {
    Scope::Gebiet { org: org(), aktion: aktion(a), gebiet: gebiet(x) }
}
fn set(grants: Vec<Grant>) -> AccessSet {
    AccessSet::new(grants)
}
/// A Austeilen-Gebiet of Gruppe `g`.
fn verteil(a: &str, x: &str, g: &str) -> Resource {
    Resource::gebiet(&org(), &aktion(a), &gebiet(x), Art::Austeilen, Some(&gruppe(g)))
}
fn abhol(a: &str, x: &str) -> Resource {
    Resource::gebiet(&org(), &aktion(a), &gebiet(x), Art::Abholen, None)
}
const NOW: u64 = 1_000;

#[test]
fn a_member_works_in_the_gebiete_of_the_own_gruppe_only() {
    let me = set(vec![Grant::new(Role::Member, at_gruppe("a1", "nord"))]);
    assert!(decide(&me, NOW, Action::Mark, &verteil("a1", "x1", "nord")).is_allowed());
    assert!(decide(&me, NOW, Action::Annotate, &verteil("a1", "x1", "nord")).is_allowed());
    assert_eq!(decide(&me, NOW, Action::Mark, &verteil("a1", "x2", "sued")), Decision::Deny(Denial::OutOfScope));
    assert_eq!(decide(&me, NOW, Action::Mark, &verteil("a2", "x1", "nord")), Decision::Deny(Denial::OutOfScope), "same names in another Aktion");
    assert_eq!(decide(&me, NOW, Action::DrawArea, &verteil("a1", "x1", "nord")), Decision::Deny(Denial::MissingCapability));
    assert_eq!(decide(&me, NOW, Action::Mark, &abhol("a1", "h1")), Decision::Deny(Denial::OutOfScope), "Abholen has no Gruppe");
    assert_eq!(decide(&me, NOW, Action::ManagePeople, &Resource::aktion(&org(), &aktion("a1"))), Decision::Deny(Denial::OutOfScope));
}

#[test]
fn a_member_sees_the_outlines_of_the_other_gruppen_but_not_their_marks() {
    let me = set(vec![Grant::new(Role::Member, at_gruppe("a1", "nord"))]);
    assert!(decide(&me, NOW, Action::Enter, &Resource::aktion(&org(), &aktion("a1"))).is_allowed());
    assert!(decide(&me, NOW, Action::Outline, &verteil("a1", "x2", "sued")).is_allowed());
    assert_eq!(decide(&me, NOW, Action::Read, &verteil("a1", "x2", "sued")), Decision::Deny(Denial::OutOfScope));
    assert_eq!(decide(&me, NOW, Action::Outline, &abhol("a1", "h1")), Decision::Deny(Denial::WrongArt), "Abholen is another world");
    assert!(!may_enter(&me, NOW, &org(), &aktion("a2")));
}

#[test]
fn a_helper_takes_a_gebiet_over_and_marks_only_there() {
    let invited = set(vec![Grant::new(Role::Helper, at_aktion("a1"))]);
    assert!(decide(&invited, NOW, Action::Collect, &abhol("a1", "h1")).is_allowed());
    assert_eq!(decide(&invited, NOW, Action::Mark, &abhol("a1", "h1")), Decision::Deny(Denial::MissingCapability), "invited, not yet taken over");
    assert_eq!(decide(&invited, NOW, Action::Read, &verteil("a1", "x1", "nord")), Decision::Deny(Denial::WrongArt));
    let working = set(vec![Grant::new(Role::Helper, at_aktion("a1")), Grant::new(Role::Helper, at_gebiet("a1", "h1"))]);
    assert!(decide(&working, NOW, Action::Mark, &abhol("a1", "h1")).is_allowed());
    assert_eq!(decide(&working, NOW, Action::Mark, &abhol("a1", "h2")), Decision::Deny(Denial::MissingCapability), "only the Gebiet taken over");
}

#[test]
fn grants_run_out() {
    let me = set(vec![Grant::new(Role::Member, at_gruppe("a1", "nord")).until(2_000)]);
    assert!(decide(&me, 1_999, Action::Mark, &verteil("a1", "x1", "nord")).is_allowed());
    assert_eq!(decide(&me, 2_000, Action::Mark, &verteil("a1", "x1", "nord")), Decision::Deny(Denial::Expired));
    assert!(!may_enter(&me, 2_000, &org(), &aktion("a1")));
    assert_eq!(decide(&AccessSet::default(), NOW, Action::Read, &Resource::aktion(&org(), &aktion("a1"))), Decision::Deny(Denial::NoGrant));
}

#[test]
fn another_organisation_is_a_stranger() {
    let other = OrgId::new("other");
    let boss = set(vec![Grant::new(Role::Owner, Scope::Organisation { org: other })]);
    assert_eq!(decide(&boss, NOW, Action::ManageSecurity, &Resource::organisation(&org())), Decision::Deny(Denial::OutOfScope));
    assert!(!may_enter(&boss, NOW, &org(), &aktion("a1")));
}

#[test]
fn people_are_handed_out_without_escalation() {
    let lead = set(vec![Grant::new(Role::Lead, at_gruppe("a1", "nord"))]);
    assert!(may_grant(&lead, NOW, Role::Member, &at_gruppe("a1", "nord")).is_allowed());
    assert_eq!(may_grant(&lead, NOW, Role::Lead, &at_gruppe("a1", "nord")), Decision::Deny(Denial::CannotHandOut));
    assert_eq!(may_grant(&lead, NOW, Role::Member, &at_gruppe("a1", "sued")), Decision::Deny(Denial::OutOfScope));
    assert_eq!(may_grant(&lead, NOW, Role::Admin, &at_aktion("a1")), Decision::Deny(Denial::OutOfScope));
    assert_eq!(may_grant(&lead, NOW, Role::Lead, &at_aktion("a1")), Decision::Deny(Denial::RoleScopeMismatch));
    let admin = set(vec![Grant::new(Role::Admin, at_aktion("a1"))]);
    assert!(may_grant(&admin, NOW, Role::Lead, &at_gruppe("a1", "sued")).is_allowed());
    assert!(may_grant(&admin, NOW, Role::Helper, &at_aktion("a1")).is_allowed());
    assert_eq!(may_grant(&admin, NOW, Role::Owner, &at_org()), Decision::Deny(Denial::OutOfScope));
    assert_eq!(may_grant(&admin, NOW, Role::Admin, &at_aktion("a2")), Decision::Deny(Denial::OutOfScope));
    let member = set(vec![Grant::new(Role::Member, at_gruppe("a1", "nord"))]);
    assert_eq!(may_grant(&member, NOW, Role::Viewer, &at_gruppe("a1", "nord")), Decision::Deny(Denial::MissingCapability));
    let owner = set(vec![Grant::new(Role::Owner, at_org())]);
    assert!(may_grant(&owner, NOW, Role::Owner, &at_org()).is_allowed());
    assert!(may_grant(&owner, NOW, Role::Helper, &at_gebiet("a9", "h1")).is_allowed());
}

// ---------- properties over random grant sets ----------

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn pick<T: Clone>(&mut self, items: &[T]) -> T {
        items[self.next() as usize % items.len()].clone()
    }
}

fn random_scope(r: &mut Lcg) -> Scope {
    let a = r.pick(&["a1", "a2"]);
    match r.next() % 4 {
        0 => at_org(),
        1 => at_aktion(a),
        2 => at_gruppe(a, r.pick(&["g1", "g2", "g3"])),
        _ => at_gebiet(a, r.pick(&["x1", "x2", "x3"])),
    }
}

fn random_grant(r: &mut Lcg) -> Grant {
    let scope = random_scope(r);
    let roles: Vec<Role> = Role::ALL.iter().copied().filter(|role| role.fits(&scope)).collect();
    let g = Grant::new(r.pick(&roles), scope);
    if r.next().is_multiple_of(4) {
        g.until(r.next() % 3_000)
    } else {
        g
    }
}

fn random_resource(r: &mut Lcg) -> Resource {
    let a = aktion(r.pick(&["a1", "a2"]));
    match r.next() % 4 {
        0 => Resource::aktion(&org(), &a),
        1 => Resource::gruppe(&org(), &a, &gruppe(r.pick(&["g1", "g2", "g3"]))),
        2 => Resource::gebiet(&org(), &a, &gebiet(r.pick(&["x1", "x2", "x3"])), Art::Austeilen, Some(&gruppe(r.pick(&["g1", "g2", "g3"])))),
        _ => Resource::gebiet(&org(), &a, &gebiet(r.pick(&["x1", "x2", "x3"])), Art::Abholen, None),
    }
}

const ACTIONS: [Action; 12] = [
    Action::Enter,
    Action::Outline,
    Action::Read,
    Action::Mark,
    Action::Annotate,
    Action::DrawArea,
    Action::ManageGroup,
    Action::StartRun,
    Action::Collect,
    Action::ManageAktion,
    Action::ManagePeople,
    Action::ManageSecurity,
];

#[test]
fn removing_a_grant_never_allows_more_and_adding_never_allows_less() {
    let mut r = Lcg(61);
    let mut allowed = 0;
    for _ in 0..4000 {
        let grants: Vec<Grant> = (0..1 + r.next() % 4).map(|_| random_grant(&mut r)).collect();
        let (res, action, now) = (random_resource(&mut r), r.pick(&ACTIONS), r.next() % 3_000);
        let full = decide(&set(grants.clone()), now, action, &res).is_allowed();
        allowed += usize::from(full);
        for skip in 0..grants.len() {
            let fewer: Vec<Grant> = grants.iter().enumerate().filter(|(i, _)| *i != skip).map(|(_, g)| g.clone()).collect();
            if decide(&set(fewer), now, action, &res).is_allowed() {
                assert!(full, "removing a grant allowed something new: {grants:?} {action:?} {res:?}");
            }
        }
    }
    assert!(allowed > 300, "enough allowed cases to mean something: {allowed}");
}

#[test]
fn a_grant_in_one_place_never_reaches_another() {
    let mut r = Lcg(62);
    for _ in 0..4000 {
        let g = random_grant(&mut r);
        let (res, action) = (random_resource(&mut r), r.pick(&ACTIONS));
        let me = set(vec![g.clone()]);
        if !matches!(action, Action::Enter | Action::Outline) && decide(&me, 0, action, &res).is_allowed() {
            // the resource must lie inside the scope
            let inside = match &g.scope {
                Scope::Organisation { .. } => true,
                Scope::Aktion { aktion, .. } => res.aktion.as_ref() == Some(aktion),
                Scope::Gruppe { aktion, gruppe, .. } => res.aktion.as_ref() == Some(aktion) && res.gruppe.as_ref() == Some(gruppe),
                Scope::Gebiet { aktion, gebiet, .. } => res.aktion.as_ref() == Some(aktion) && res.gebiet.as_ref() == Some(gebiet),
            };
            assert!(inside, "{g:?} allowed {action:?} on {res:?}");
        }
    }
}

#[test]
fn nobody_works_in_the_wrong_world() {
    let mut r = Lcg(63);
    for _ in 0..4000 {
        let g = random_grant(&mut r);
        let res = random_resource(&mut r);
        for action in [Action::Mark, Action::Annotate, Action::DrawArea, Action::Collect, Action::Read] {
            if decide(&set(vec![g.clone()]), 0, action, &res).is_allowed() {
                if let Some(art) = res.art {
                    assert!(g.role.works_in(art), "{:?} allowed {action:?} in {art:?}", g.role);
                }
            }
        }
    }
}

#[test]
fn what_is_handed_out_is_never_more_than_the_giver_has() {
    let mut r = Lcg(64);
    let mut handed = 0;
    for _ in 0..6000 {
        let giver = set(vec![random_grant(&mut r)]);
        let (scope, role) = (random_scope(&mut r), r.pick(&Role::ALL));
        if may_grant(&giver, 0, role, &scope).is_allowed() {
            handed += 1;
            let g = &giver.grants[0];
            let depth = g.scope.depth();
            // every capability of the new role (as it will work at the target scope) the giver has too, except the Helper's, which only a taking-over creates
            let given: Vec<Capability> = role.capabilities_at(scope.depth()).to_vec();
            let own: Vec<Capability> = g.role.capabilities_at(depth).to_vec();
            if role != Role::Helper {
                for c in given {
                    assert!(own.contains(&c), "{:?} at {:?} handed out {role:?} with {c:?}", g.role, g.scope);
                }
            }
            assert!(role.fits(&scope));
        }
    }
    assert!(handed > 200, "enough hand-outs to mean something: {handed}");
}
