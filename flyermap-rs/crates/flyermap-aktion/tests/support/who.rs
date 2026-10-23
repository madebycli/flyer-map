//! The cast: every role of Plan 061 §3 as a caller of the Aktion `a1`, and some who must get nowhere.
use flyermap_aktion::Caller;
use flyermap_identity::{AccessSet, AktionId, GebietId, Grant, GruppeId, OrgId, Role, Scope};

pub fn org() -> OrgId {
    OrgId::new("org")
}

pub fn aktion() -> AktionId {
    AktionId::new("a1")
}

pub fn at_organisation() -> Scope {
    Scope::Organisation { org: org() }
}

pub fn at_aktion() -> Scope {
    Scope::Aktion { org: org(), aktion: aktion() }
}

pub fn at_gruppe(gruppe: &str) -> Scope {
    Scope::Gruppe { org: org(), aktion: aktion(), gruppe: GruppeId::new(gruppe) }
}

pub fn at_gebiet(gebiet: &str) -> Scope {
    Scope::Gebiet { org: org(), aktion: aktion(), gebiet: GebietId::new(gebiet) }
}

pub fn with(name: &str, grants: Vec<Grant>) -> Caller {
    Caller::new(name, AccessSet::new(grants))
}

pub fn owner() -> Caller {
    with("owner", vec![Grant::new(Role::Owner, at_organisation())])
}

pub fn admin() -> Caller {
    with("admin", vec![Grant::new(Role::Admin, at_aktion())])
}

pub fn lead(gruppe: &str) -> Caller {
    with(&format!("lead-{gruppe}"), vec![Grant::new(Role::Lead, at_gruppe(gruppe))])
}

pub fn member(gruppe: &str) -> Caller {
    with(&format!("member-{gruppe}"), vec![Grant::new(Role::Member, at_gruppe(gruppe))])
}

/// Invited into the Aktion: may look and take a Gebiet over.
pub fn helper(name: &str) -> Caller {
    with(name, vec![Grant::new(Role::Helper, at_aktion())])
}

/// A Helper who has taken `gebiet` over: the grant that the owner of the grants makes when the `Collected` entry arrives.
pub fn helper_at(name: &str, gebiet: &str) -> Caller {
    with(name, vec![Grant::new(Role::Helper, at_aktion()), Grant::new(Role::Helper, at_gebiet(gebiet))])
}

pub fn viewer() -> Caller {
    with("viewer", vec![Grant::new(Role::Viewer, at_aktion())])
}

/// An Admin of another Aktion of the same Organisation.
pub fn stranger() -> Caller {
    with("stranger", vec![Grant::new(Role::Admin, Scope::Aktion { org: org(), aktion: AktionId::new("a2") })])
}

/// Somebody whose grants have all run out.
pub fn expired() -> Caller {
    with("expired", vec![Grant::new(Role::Admin, at_aktion()).until(1_000)])
}

pub fn nobody() -> Caller {
    with("nobody", Vec::new())
}
