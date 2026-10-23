//! The one decision function. A request brings the caller's grants (loaded once, at the edge); everything allowed or forbidden is answered here.
use crate::{Action, AktionId, Art, Grant, OrgId, Resource, Role, Scope};
use serde::{Deserialize, Serialize};

/// All grants of one session. Cheap to build, cheap to ask.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessSet {
    pub grants: Vec<Grant>,
}

impl AccessSet {
    pub fn new(grants: Vec<Grant>) -> AccessSet {
        AccessSet { grants }
    }

    pub fn active(&self, now: u64) -> impl Iterator<Item = &Grant> {
        self.grants.iter().filter(move |g| g.is_active(now))
    }
}

/// Why something is refused. For the audit log and for a useful hint in the app; never used to decide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Denial {
    /// No grants at all.
    NoGrant,
    /// Grants exist but all have run out.
    Expired,
    /// Grants exist, but not for this place.
    OutOfScope,
    /// A grant covers the place, but its role does not work in this world (a Helper on a Austeilen-Gebiet, a Member on Abholen).
    WrongArt,
    /// A grant covers the place, but its role lacks the capability.
    MissingCapability,
    /// The role does not fit the scope it should be handed out at.
    RoleScopeMismatch,
    /// The giver may not hand out that role there.
    CannotHandOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny(Denial),
}

impl Decision {
    pub fn is_allowed(self) -> bool {
        self == Decision::Allow
    }
}

/// Does a grant at `scope` reach `resource`?
fn covers(scope: &Scope, resource: &Resource) -> bool {
    if scope.org() != &resource.org {
        return false;
    }
    match scope {
        Scope::Organisation { .. } => true,
        Scope::Aktion { aktion, .. } => resource.aktion.as_ref() == Some(aktion),
        Scope::Gruppe { aktion, gruppe, .. } => resource.aktion.as_ref() == Some(aktion) && resource.gruppe.as_ref() == Some(gruppe),
        Scope::Gebiet { aktion, gebiet, .. } => resource.aktion.as_ref() == Some(aktion) && resource.gebiet.as_ref() == Some(gebiet),
    }
}

/// Is `inner` the same place as `outer` or inside it? (A Gebiet is never known to be inside a Gruppe from the scopes alone.)
fn contains(outer: &Scope, inner: &Scope) -> bool {
    if outer.org() != inner.org() {
        return false;
    }
    match (outer, inner) {
        (Scope::Organisation { .. }, _) => true,
        (Scope::Aktion { aktion, .. }, other) => other.aktion() == Some(aktion),
        (a @ Scope::Gruppe { .. }, b @ Scope::Gruppe { .. }) | (a @ Scope::Gebiet { .. }, b @ Scope::Gebiet { .. }) => a == b,
        _ => false,
    }
}

/// Does the grant touch this Aktion at all (any scope on the way down to it, or the Organisation above it)?
fn touches(scope: &Scope, org: &OrgId, aktion: &AktionId) -> bool {
    scope.org() == org && scope.aktion().is_none_or(|a| a == aktion)
}

/// The decision. Pure: grants, the time and the question are all it needs.
pub fn decide(access: &AccessSet, now: u64, action: Action, resource: &Resource) -> Decision {
    if access.grants.is_empty() {
        return Decision::Deny(Denial::NoGrant);
    }
    let active: Vec<&Grant> = access.active(now).collect();
    if active.is_empty() {
        return Decision::Deny(Denial::Expired);
    }
    match action {
        Action::Enter => {
            let in_aktion = resource
                .aktion
                .as_ref()
                .map_or_else(|| active.iter().any(|g| g.scope.org() == &resource.org), |a| active.iter().any(|g| touches(&g.scope, &resource.org, a)));
            if in_aktion {
                Decision::Allow
            } else {
                Decision::Deny(Denial::OutOfScope)
            }
        }
        Action::Outline => {
            let Some(aktion) = resource.aktion.as_ref() else { return Decision::Deny(Denial::OutOfScope) };
            let mut seen = false;
            for g in active.iter().filter(|g| touches(&g.scope, &resource.org, aktion)) {
                seen = true;
                if resource.art.is_none_or(|art| g.role.works_in(art)) {
                    return Decision::Allow;
                }
            }
            Decision::Deny(if seen { Denial::WrongArt } else { Denial::OutOfScope })
        }
        _ => {
            let Some(capability) = action.capability() else { return Decision::Deny(Denial::MissingCapability) };
            let mut reason = Denial::OutOfScope;
            for g in active.iter().filter(|g| covers(&g.scope, resource)) {
                if resource.art.is_some_and(|art| !g.role.works_in(art)) {
                    if reason == Denial::OutOfScope {
                        reason = Denial::WrongArt;
                    }
                    continue;
                }
                if g.role.capabilities_at(g.scope.depth()).contains(&capability) {
                    return Decision::Allow;
                }
                reason = Denial::MissingCapability;
            }
            Decision::Deny(reason)
        }
    }
}

/// May the caller see that this Aktion exists and open it?
pub fn may_enter(access: &AccessSet, now: u64, org: &OrgId, aktion: &AktionId) -> bool {
    decide(access, now, Action::Enter, &Resource::aktion(org, aktion)).is_allowed()
}

/// May the caller hand out `role` at `scope`? Needs the right to manage people there, a role the giver may hand out, and a role that fits the
/// scope. Nobody hands out more than they have: that is what [`Role::may_hand_out`] guarantees (tested as a property).
pub fn may_grant(access: &AccessSet, now: u64, role: Role, scope: &Scope) -> Decision {
    if !role.fits(scope) {
        return Decision::Deny(Denial::RoleScopeMismatch);
    }
    if access.grants.is_empty() {
        return Decision::Deny(Denial::NoGrant);
    }
    let mut reason = Denial::OutOfScope;
    for g in access.active(now).filter(|g| contains(&g.scope, scope)) {
        if !g.role.capabilities_at(g.scope.depth()).contains(&crate::Capability::ManagePeople) {
            reason = Denial::MissingCapability;
            continue;
        }
        if g.role.may_hand_out().contains(&role) {
            return Decision::Allow;
        }
        reason = Denial::CannotHandOut;
    }
    if reason == Denial::OutOfScope && access.active(now).next().is_none() {
        return Decision::Deny(Denial::Expired);
    }
    Decision::Deny(reason)
}

/// Used by tests and by the app to list what a role may do in a world.
pub fn arts_of(role: Role) -> Vec<Art> {
    [Art::Austeilen, Art::Abholen].into_iter().filter(|a| role.works_in(*a)).collect()
}
